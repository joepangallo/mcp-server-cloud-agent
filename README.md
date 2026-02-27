# mcp-server-cloud-agent

MCP server for **Cloud Agent** — an AI software engineer that writes code, opens PRs, reviews code, generates tests, runs security scans, and answers codebase questions.

Connect from any MCP client (Claude Code, Cursor, Windsurf, or your own agents) and delegate engineering tasks.

## Tools (9)

| Tool | Description |
|------|-------------|
| `run_task` | Write code, fix bugs, add features — returns result + PR URL |
| `review_pr` | Review a GitHub PR with structured feedback, optionally post to GitHub |
| `ask_codebase` | Ask questions about any GitHub repo (auto-indexes on first use) |
| `generate_tests` | Generate tests for a file or feature, opens a PR |
| `security_scan` | Security + dependency scan across one or more repos |
| `list_sessions` | List recent sessions with status, cost, duration, PR URLs |
| `list_playbooks` | List available workflow templates (bug-triage, test-coverage, etc.) |
| `run_playbook` | Run a playbook against a repo |
| `get_usage` | Usage stats — sessions, cost, time saved, breakdowns |

## Setup

### 1. Get an API key

Sign in to your Cloud Agent web workspace and generate an API key at `/auth/api-key`.

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
| `CLOUD_AGENT_URL` | No | Backend URL (defaults to `https://cloudagent.metaltorque.dev`) |

## Usage Examples

Once configured, your MCP client can call these tools directly:

**Fix a bug:**
> "Use cloud-agent to fix the broken login flow in myorg/myapp"

**Review a PR:**
> "Use cloud-agent to review https://github.com/myorg/myapp/pull/42"

**Ask about code:**
> "Use cloud-agent to explain how authentication works in myorg/myapp"

**Generate tests:**
> "Use cloud-agent to generate tests for src/auth.ts in myorg/myapp"

**Security scan:**
> "Use cloud-agent to scan myorg/myapp and myorg/api for vulnerabilities"

**Run a playbook:**
> "Use cloud-agent to run the bug-triage playbook on myorg/myapp"

## What is Cloud Agent?

Cloud Agent is a Devin-alternative that puts an AI software engineer where your team already works — Slack, Teams, Jira, Linear, and 12 more platforms. It writes code, opens PRs, reviews code, generates tests, runs security scans, and answers codebase questions.

This MCP server gives any MCP-compatible AI client the same capabilities.

## License

MIT
