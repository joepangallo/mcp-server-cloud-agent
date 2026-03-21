# mcp-server-cloud-agent

MCP server for **Cloud Agent** — a hosted AI software engineer that writes code, opens PRs, reviews code, generates tests, runs security scans, and answers codebase questions.

Connect from any MCP client (Claude Code, Cursor, Windsurf, or your own agents) and delegate engineering tasks.

## How it works

This package is a **local stdio MCP proxy** that forwards requests to the Cloud Agent hosted backend at `agent.leddconsulting.com`. Your MCP client communicates with this server over stdio; the server makes authenticated HTTPS calls to the backend on your behalf.

Legacy `cloudagent.metaltorque.dev` URLs still redirect, but new configs should use `agent.leddconsulting.com`.

**Data flow:** MCP client → (stdio) → this server → (HTTPS) → Cloud Agent backend → GitHub

**What data leaves your machine:**
- Task descriptions, repo names, file paths, and PR URLs you provide
- Your API key (sent over HTTPS only, never over HTTP)

**What the backend does with your data:**
- Clones repos from GitHub using its own GitHub App credentials
- Executes tasks in isolated sandboxes
- Opens PRs and posts reviews to GitHub on your behalf

## Tools (9)

| Tool | Description | Side effects |
|------|-------------|--------------|
| `run_task` | Write code, fix bugs, add features — returns result + PR URL | Creates branches and PRs |
| `review_pr` | Review a GitHub PR with structured feedback | Optionally posts comments to GitHub |
| `ask_codebase` | Ask questions about any GitHub repo (auto-indexes on first use) | Read-only |
| `generate_tests` | Generate tests for a file, opens a PR | Creates branches and PRs |
| `security_scan` | Security + dependency scan across one or more repos | Read-only |
| `list_sessions` | List recent sessions with status, cost, duration, PR URLs | Read-only |
| `list_playbooks` | List available workflow templates | Read-only |
| `run_playbook` | Run a playbook against a repo | Creates branches and PRs |
| `get_usage` | Usage stats — sessions, cost, time saved, breakdowns | Read-only |

## Setup

### 1. Get an API key

Sign in to your Cloud Agent workspace at [agent.leddconsulting.com](https://agent.leddconsulting.com) and generate an API key at `/auth/api-key`. Keys use the `ca_*` prefix.

### 2. Configure your MCP client

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "cloud-agent": {
      "command": "npx",
      "args": ["-y", "mcp-server-cloud-agent"],
      "env": {
        "CLOUD_AGENT_API_KEY": "ca_your_key_here"
      }
    }
  }
}
```

**Cursor / Windsurf** (MCP settings):
```json
{
  "mcpServers": {
    "cloud-agent": {
      "command": "npx",
      "args": ["-y", "mcp-server-cloud-agent"],
      "env": {
        "CLOUD_AGENT_API_KEY": "ca_your_key_here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUD_AGENT_API_KEY` | Yes | API key (`ca_*` prefix) from your Cloud Agent workspace |
| `CLOUD_AGENT_URL` | No | Backend URL (defaults to `https://agent.leddconsulting.com`) |

## Usage Examples

Once configured, your MCP client can call these tools directly:

**Fix a bug:**
> "Use cloud-agent run_task on myorg/myapp to fix the broken login flow"

**Review a PR:**
> "Use cloud-agent review_pr on https://github.com/myorg/myapp/pull/42"

**Ask about code:**
> "Use cloud-agent ask_codebase on myorg/myapp: how does authentication work?"

**Generate tests:**
> "Use cloud-agent generate_tests on myorg/myapp for src/auth.ts"

**Security scan:**
> "Use cloud-agent security_scan on myorg/myapp and myorg/api"

## Sample Output

**run_task response:**
```json
{
  "response": "Fixed the login redirect bug. Changed src/auth.ts to properly handle OAuth callback URLs.",
  "cost_usd": 0.42,
  "duration_ms": 45000,
  "pr_url": "https://github.com/myorg/myapp/pull/87"
}
```

**security_scan response:**
```json
{
  "repos_scanned": 1,
  "vulnerabilities": 3,
  "secrets_found": 0,
  "findings": [...]
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "CLOUD_AGENT_API_KEY is required" | Set the env var in your MCP client config |
| "Refusing to send API key over insecure HTTP" | Use HTTPS (the default). Don't set `CLOUD_AGENT_URL` to an HTTP URL |
| "Request timed out" | Tasks can take up to 10 minutes. Check `list_sessions` for status |
| "HTTP 401" | Your API key is invalid or expired. Generate a new one |
| "HTTP 429" | Rate limited. Wait and retry |

## License

MIT
