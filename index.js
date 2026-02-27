#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const https = require("https");
const http = require("http");
const { version } = require("./package.json");

// ── Config ──────────────────────────────────────────────────────────

const API_KEY = process.env.CLOUD_AGENT_API_KEY || "";
const BASE_URL = (process.env.CLOUD_AGENT_URL || "https://cloudagent.metaltorque.dev").replace(/\/$/, "");

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

function noKeyError() {
  return {
    content: [{
      type: "text",
      text: "Error: CLOUD_AGENT_API_KEY environment variable is required.\n\nGet an API key from your Cloud Agent web workspace at /auth/api-key.\nAPI keys use the ca_* prefix.",
    }],
  };
}

// ── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "cloud-agent",
  version,
});

// ── Tool: run_task ──────────────────────────────────────────────────

server.tool(
  "run_task",
  "Run a coding task: write code, fix bugs, add features, refactor. The AI agent clones the repo, makes changes, and opens a PR. Returns the result and PR URL when complete.",
  {
    prompt: z.string().describe("Task description, e.g. 'Fix the login bug in owner/repo' or 'Add dark mode to owner/repo'"),
  },
  async ({ prompt }) => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("POST", "/query", { prompt });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            response: result.response,
            cost_usd: result.cost_usd,
            duration_ms: result.duration_ms,
            pr_url: result.pr_url || null,
          }, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: review_pr ─────────────────────────────────────────────────

server.tool(
  "review_pr",
  "Review a GitHub pull request. Returns structured feedback with issues, verdict, and suggestions. Optionally posts review comments directly to GitHub.",
  {
    pr_url: z.string().describe("Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/123"),
    post_comments: z.boolean().optional().describe("Post review comments directly to GitHub (default: false)"),
  },
  async ({ pr_url, post_comments }) => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("POST", "/review", {
        pr_url,
        post_review: post_comments === true,
      });
      return {
        content: [{
          type: "text",
          text: result.review || JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: ask_codebase ──────────────────────────────────────────────

server.tool(
  "ask_codebase",
  "Ask a question about any GitHub repository's codebase. Auto-indexes the repo on first use. Returns an answer with file references.",
  {
    question: z.string().describe("Question about the codebase, e.g. 'How does authentication work?'"),
    repo: z.string().describe("GitHub repo in owner/repo format, e.g. 'facebook/react'"),
  },
  async ({ question, repo }) => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("POST", "/ask", { question, repo });
      return {
        content: [{
          type: "text",
          text: result.answer || JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: generate_tests ────────────────────────────────────────────

server.tool(
  "generate_tests",
  "Generate tests for a file or feature in a GitHub repository. Creates test files and opens a PR with them.",
  {
    repo: z.string().describe("GitHub repo in owner/repo format"),
    file: z.string().optional().describe("Specific file to test, e.g. 'src/auth.ts'"),
    feature: z.string().optional().describe("Feature to test, e.g. 'user authentication'"),
  },
  async ({ repo, file, feature }) => {
    if (!API_KEY) return noKeyError();
    const target = file || feature;
    if (!target) {
      return { content: [{ type: "text", text: "Error: Provide either 'file' or 'feature' to test." }] };
    }
    try {
      const result = await request("POST", "/test", { file, feature, repo });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            response: result.response,
            cost_usd: result.cost_usd,
            duration_ms: result.duration_ms,
            pr_url: result.pr_url || null,
          }, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: security_scan ─────────────────────────────────────────────

server.tool(
  "security_scan",
  "Run a security and dependency scan on one or more GitHub repositories. Checks for vulnerabilities, secret exposure, and security anti-patterns.",
  {
    repos: z.array(z.string()).describe("Array of repos in owner/repo format, e.g. ['owner/repo1', 'owner/repo2']"),
    type: z.enum(["all", "dependencies", "secrets", "code"]).optional().describe("Scan type (default: all)"),
  },
  async ({ repos, type }) => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("POST", "/scan", { repos, type: type || "all" });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_sessions ─────────────────────────────────────────────

server.tool(
  "list_sessions",
  "List recent agent sessions with status, cost, duration, and PR URLs. Use to check on past or running tasks.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max sessions to return (default: 20)"),
    status: z.enum(["running", "completed", "error"]).optional().describe("Filter by session status"),
  },
  async ({ limit, status }) => {
    if (!API_KEY) return noKeyError();
    try {
      let path = `/api/sessions?limit=${limit || 20}`;
      if (status) path += `&status=${status}`;
      const result = await request("GET", path);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.sessions || result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_playbooks ────────────────────────────────────────────

server.tool(
  "list_playbooks",
  "List available playbooks — reusable workflow templates for common engineering tasks like bug triage, security remediation, test coverage, docs sync, and more.",
  {},
  async () => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("GET", "/api/playbooks");
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: run_playbook ──────────────────────────────────────────────

server.tool(
  "run_playbook",
  "Run a playbook (reusable workflow template) against a repository. Use list_playbooks to see available options. Built-in playbooks include: bug-triage, security-remediation, dependency-upgrade, docs-sync, test-coverage, code-migration, pr-review-cycle.",
  {
    slug: z.string().describe("Playbook slug, e.g. 'bug-triage', 'security-remediation', 'test-coverage'"),
    repo: z.string().describe("GitHub repo in owner/repo format"),
    inputs: z.record(z.string()).optional().describe("Additional inputs for the playbook template variables"),
  },
  async ({ slug, repo, inputs }) => {
    if (!API_KEY) return noKeyError();
    try {
      const result = await request("POST", `/api/playbooks/${encodeURIComponent(slug)}/run`, { repo, inputs });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_usage ─────────────────────────────────────────────────

server.tool(
  "get_usage",
  "Get usage statistics: total sessions, cost, estimated time saved, breakdowns by source, repo, and user. Useful for tracking ROI.",
  {
    days: z.number().int().min(1).max(365).optional().describe("Number of days to look back (default: all time)"),
  },
  async ({ days }) => {
    if (!API_KEY) return noKeyError();
    try {
      const path = days ? `/api/usage?days=${days}` : "/api/usage";
      const result = await request("GET", path);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
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
