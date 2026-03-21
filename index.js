#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const https = require("https");
const http = require("http");
const { version } = require("./package.json");

// ── Config ──────────────────────────────────────────────────────────

const API_KEY = process.env.CLOUD_AGENT_API_KEY || "";
const BASE_URL = (process.env.CLOUD_AGENT_URL || "https://agent.leddconsulting.com").replace(/\/$/, "");

// ── Shared schemas ──────────────────────────────────────────────────

const repoSchema = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "Must be owner/repo format, e.g. 'facebook/react'");
const prUrlSchema = z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/, "Must be a GitHub PR URL, e.g. https://github.com/owner/repo/pull/123");

// ── HTTP helper ─────────────────────────────────────────────────────

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

function request(method, urlPath, body, timeout = 600_000) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${BASE_URL}${urlPath}`;
    const parsed = new URL(fullUrl);
    const isHttps = parsed.protocol === "https:";

    if (!isHttps && API_KEY) {
      return reject(new Error("Refusing to send API key over insecure HTTP. Use HTTPS."));
    }

    const mod = isHttps ? https : http;

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": `mcp-server-cloud-agent/${version}`,
    };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout,
    };

    const req = mod.request(opts, (res) => {
      let data = "";
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_SIZE) { req.destroy(); return reject(new Error("Response too large")); }
        data += c;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error(json.error || `HTTP ${res.statusCode}`));
          resolve(json);
        } catch {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Shared helpers ──────────────────────────────────────────────────

function noKeyError() {
  return {
    isError: true,
    content: [{
      type: "text",
      text: "Error: CLOUD_AGENT_API_KEY environment variable is required.\n\nGet an API key from your Cloud Agent web workspace at /auth/api-key.\nAPI keys use the ca_* prefix.",
    }],
  };
}

function errorResult(e) {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${e.message}` }],
  };
}

function toolResult(text) {
  return {
    content: [{ type: "text", text }],
  };
}

async function authedCall(method, path, body, formatter) {
  if (!API_KEY) return noKeyError();
  try {
    const result = await request(method, path, body);
    return toolResult(formatter(result));
  } catch (e) {
    return errorResult(e);
  }
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "cloud-agent",
  version,
});

// ── Tool: run_task ──────────────────────────────────────────────────
// Positional: tool(name, description, paramsSchema, annotations, handler)

server.tool(
  "run_task",
  "Run a coding task: write code, fix bugs, add features, refactor. The AI agent clones the repo, makes changes, and opens a PR. Returns the result and PR URL when complete.",
  {
    repo: repoSchema.describe("GitHub repo in owner/repo format, e.g. 'facebook/react'"),
    task: z.string().min(1).describe("Task description, e.g. 'Fix the login bug' or 'Add dark mode to the settings page'"),
    base_branch: z.string().optional().describe("Branch to base changes on (default: main)"),
  },
  { destructiveHint: true, readOnlyHint: false, openWorldHint: true },
  async ({ repo, task, base_branch }) => {
    const prompt = base_branch
      ? `In ${repo} (branch: ${base_branch}): ${task}`
      : `In ${repo}: ${task}`;
    return authedCall("POST", "/query", { prompt }, (result) =>
      JSON.stringify({
        response: result.response,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
        pr_url: result.pr_url || null,
      }, null, 2)
    );
  }
);

// ── Tool: review_pr ─────────────────────────────────────────────────

server.tool(
  "review_pr",
  "Review a GitHub pull request. Returns structured feedback with issues, verdict, and suggestions. Optionally posts review comments directly to GitHub.",
  {
    pr_url: prUrlSchema.describe("Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/123"),
    post_comments: z.boolean().optional().describe("Post review comments directly to GitHub (default: false)"),
  },
  { destructiveHint: false, readOnlyHint: false, openWorldHint: true },
  async ({ pr_url, post_comments }) =>
    authedCall("POST", "/review", { pr_url, post_review: post_comments === true }, (result) =>
      result.review || JSON.stringify(result, null, 2)
    )
);

// ── Tool: ask_codebase ──────────────────────────────────────────────

server.tool(
  "ask_codebase",
  "Ask a question about any GitHub repository's codebase. Auto-indexes the repo on first use. Returns an answer with file references.",
  {
    question: z.string().min(1).describe("Question about the codebase, e.g. 'How does authentication work?'"),
    repo: repoSchema.describe("GitHub repo in owner/repo format, e.g. 'facebook/react'"),
  },
  { destructiveHint: false, readOnlyHint: true, openWorldHint: true },
  async ({ question, repo }) =>
    authedCall("POST", "/ask", { question, repo }, (result) =>
      result.answer || JSON.stringify(result, null, 2)
    )
);

// ── Tool: generate_tests ────────────────────────────────────────────

server.tool(
  "generate_tests",
  "Generate tests for a specific file in a GitHub repository. Creates test files and opens a PR with them.",
  {
    repo: repoSchema.describe("GitHub repo in owner/repo format"),
    file: z.string().min(1).describe("File to generate tests for, e.g. 'src/auth.ts'"),
  },
  { destructiveHint: true, readOnlyHint: false, openWorldHint: true },
  async ({ repo, file }) =>
    authedCall("POST", "/test", { file, repo }, (result) =>
      JSON.stringify({
        response: result.response,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
        pr_url: result.pr_url || null,
      }, null, 2)
    )
);

// ── Tool: security_scan ─────────────────────────────────────────────

server.tool(
  "security_scan",
  "Run a security and dependency scan on one or more GitHub repositories. Checks for vulnerabilities, secret exposure, and security anti-patterns.",
  {
    repos: z.array(repoSchema).min(1).describe("Array of repos in owner/repo format, e.g. ['owner/repo1', 'owner/repo2']"),
    type: z.enum(["all", "dependencies", "secrets", "code"]).optional().describe("Scan type (default: all)"),
  },
  { destructiveHint: false, readOnlyHint: true, openWorldHint: true },
  async ({ repos, type }) =>
    authedCall("POST", "/scan", { repos, type: type || "all" }, (result) =>
      JSON.stringify(result, null, 2)
    )
);

// ── Tool: list_sessions ─────────────────────────────────────────────

server.tool(
  "list_sessions",
  "List recent agent sessions with status, cost, duration, and PR URLs. Use to check on past or running tasks.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max sessions to return (default: 20)"),
    status: z.enum(["running", "completed", "error"]).optional().describe("Filter by session status"),
  },
  { destructiveHint: false, readOnlyHint: true, openWorldHint: false },
  async ({ limit, status }) => {
    let path = `/api/sessions?limit=${limit || 20}`;
    if (status) path += `&status=${status}`;
    return authedCall("GET", path, undefined, (result) =>
      JSON.stringify(result.sessions || result, null, 2)
    );
  }
);

// ── Tool: list_playbooks ────────────────────────────────────────────

server.tool(
  "list_playbooks",
  "List available playbooks — reusable workflow templates for common engineering tasks like bug triage, security remediation, test coverage, docs sync, and more.",
  {},
  { destructiveHint: false, readOnlyHint: true, openWorldHint: false },
  async () => authedCall("GET", "/api/playbooks", undefined, (result) =>
    JSON.stringify(result, null, 2)
  )
);

// ── Tool: run_playbook ──────────────────────────────────────────────

server.tool(
  "run_playbook",
  "Run a playbook (reusable workflow template) against a repository. Use list_playbooks to see available options. Built-in playbooks include: bug-triage, security-remediation, dependency-upgrade, docs-sync, test-coverage, code-migration, pr-review-cycle.",
  {
    slug: z.string().min(1).describe("Playbook slug, e.g. 'bug-triage', 'security-remediation', 'test-coverage'"),
    repo: repoSchema.describe("GitHub repo in owner/repo format"),
    inputs: z.record(z.string()).optional().describe("Additional inputs for the playbook template variables"),
  },
  { destructiveHint: true, readOnlyHint: false, openWorldHint: true },
  async ({ slug, repo, inputs }) =>
    authedCall("POST", `/api/playbooks/${encodeURIComponent(slug)}/run`, { repo, inputs }, (result) =>
      JSON.stringify(result, null, 2)
    )
);

// ── Tool: get_usage ─────────────────────────────────────────────────

server.tool(
  "get_usage",
  "Get usage statistics: total sessions, cost, estimated time saved, breakdowns by source, repo, and user. Useful for tracking ROI.",
  {
    days: z.number().int().min(1).max(365).optional().describe("Number of days to look back (default: all time)"),
  },
  { destructiveHint: false, readOnlyHint: true, openWorldHint: false },
  async ({ days }) => {
    const path = days ? `/api/usage?days=${days}` : "/api/usage";
    return authedCall("GET", path, undefined, (result) =>
      JSON.stringify(result, null, 2)
    );
  }
);

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("MCP server error:", e);
  process.exit(1);
});
