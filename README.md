# MCP Manager for VS Code

A VS Code extension that gives you a sidebar for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) MCP server configurations. View, enable/disable, and health-check all your MCP servers from one place.

## Features

- **Unified sidebar view** — See all MCP servers across project, global, local, managed, and plugin scopes in a single tree
- **One-click toggle** — Enable or disable servers with checkboxes; changes are written to the correct config file automatically
- **Two-tier health checks** — Lightweight auto-checks on refresh (binary lookup, HTTP HEAD) plus deep manual checks (full MCP SDK handshake with ping and tool listing)
- **Plugin discovery** — Automatically detects MCP servers provided by installed Claude Code plugins
- **Claude Code settings** — Configure `ENABLE_TOOL_SEARCH` and other environment variables directly from the sidebar
- **Edit config in-place** — Right-click any server to open its source config file in the editor

## TreeView

```
MCP Manager (activity bar icon)
├── Project MCPs          servers from .mcp.json
├── Global MCPs           servers from ~/.claude.json (mcpServers)
├── Local MCPs            per-project servers from ~/.claude.json
├── Managed MCPs          enterprise/platform configs (read-only)
└── Settings
    ├── Auto Health Check
    ├── Health Check Timeout
    └── Tool Search Mode
```

Each server shows a checkbox for toggle, a health icon, and a rich tooltip with connection details.

## Health Checks

| Tier | Trigger | What it does |
|------|---------|--------------|
| **Tier 1 (auto)** | Tree refresh | `which` lookup for stdio commands; HTTP HEAD for SSE endpoints |
| **Tier 2 (manual)** | Context menu or toolbar button | Full MCP Client handshake — connect, ping, list tools |

Results are cached for 5 minutes. Health statuses include: Healthy, Degraded, BinaryFound, Reachable, Unreachable, CommandNotFound, AuthFailed, and Error.

## Toggle Strategies

The extension writes to the correct config file depending on server scope:

| Scope | Strategy | Config file |
|-------|----------|-------------|
| Global / Local | Key-move between `mcpServers` and `_disabled_mcpServers` | `~/.claude.json` |
| Project | Add/remove from `disabledMcpjsonServers` array | `.claude/settings.local.json` |
| Plugin | Set `enabledPlugins[pluginId]` boolean | `~/.claude/settings.json` |

Managed servers are read-only and cannot be toggled.

## Commands

All commands are available from the Command Palette under the **MCP Manager** category:

| Command | Description |
|---------|-------------|
| Refresh MCP Servers | Reload config files and run Tier 1 checks |
| Enable / Disable Server | Toggle a server on or off |
| Edit Config File | Open the server's source config in the editor |
| Check Health | Run a Tier 2 deep check on a single server |
| Check All Health | Run Tier 2 checks on all enabled servers |
| Edit Setting | Change an extension setting |
| Edit Claude Code Setting | Change a Claude Code environment setting |

## Settings

**Extension settings** (stored in `~/.claude/mcp-manager-settings.json`):

| Setting | Values | Default | Description |
|---------|--------|---------|-------------|
| Auto Health Check | `none`, `httpOnly`, `all` | `all` | Which Tier 1 checks run automatically |
| Health Check Timeout | 1000–120000 ms | 15000 | Timeout for Tier 2 checks |

**Claude Code settings** (stored in `~/.claude/settings.json` → `env`):

| Setting | Values | Default | Description |
|---------|--------|---------|-------------|
| Tool Search Mode | `auto`, `true`, `false` | `auto` | Maps to `ENABLE_TOOL_SEARCH` env var |

## Requirements

- VS Code `^1.80.0`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and configured

## Development

```bash
npm install
npm run compile    # Build with esbuild
npm run watch      # Build + watch
npm test           # Run tests (vitest)
npm run lint       # ESLint
```

## License

MIT
