# MCP Manager for VS Code — Product Requirements Document

## Version: 2.1 (MVP + Plugin Integration + Health Checks + Settings + Sorting)

## Problem Statement

Claude Code uses MCP (Model Context Protocol) servers configured across multiple JSON files and installed plugins, but provides no GUI to manage them. Users must manually edit JSON to enable/disable servers and plugins, which is error-prone and tedious. There is no native `disabled` flag in the MCP config schema, and plugin toggles require knowing the `enabledPlugins` map format. Additionally, there is no visibility into server health — users have no way to know if a configured server is actually reachable or functional without trial and error.

## Target Users

- Developers using Claude Code in VS Code who have multiple MCP servers configured
- Teams sharing project-level MCP configs via `.mcp.json` who want personal toggle preferences
- Users with Claude Code plugins (e.g., Playwright, Supabase, GitHub) that provide MCP servers
- Users who want to monitor server health and diagnose connectivity issues

## Goals

1. Provide a visual sidebar to see all MCP servers across all config scopes at a glance
2. Enable one-click toggling of individual servers without manual JSON editing
3. Avoid modifying git-tracked `.mcp.json` for personal toggle preferences
4. Preserve server configurations non-destructively (no data loss on disable)
5. Display and toggle plugin-provided MCP servers alongside hand-configured ones
6. Provide health check visibility — show whether servers are reachable, healthy, or broken
7. Allow users to manage extension and Claude Code settings directly from the sidebar

## Non-Goals (MVP)

- Hot-reload of MCP servers (Claude Code requires restart)
- Auto-detection of Claude Code installation status
- File watching for external config changes (manual refresh only)
- Add/remove server wizards
- Status bar indicators
- Displaying non-MCP plugins (plugins that only provide hooks, skills, agents, LSP, or output styles)
- Per-server plugin toggle granularity (toggling is at the plugin level — all servers from a plugin toggle together)

## Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-1 | Display all MCP servers grouped by scope (Project, Global, Local, Managed) in a sidebar TreeView | P0 | Done |
| FR-2 | Show server name, transport type (stdio/http), and command/URL for each entry | P0 | Done |
| FR-3 | Provide checkbox on each server item to toggle enabled/disabled state | P0 | Done |
| FR-4 | Toggle global/user/local servers by moving entries between `mcpServers` and `_disabled_mcpServers` keys in `~/.claude.json` (Strategy A) | P0 | Done |
| FR-5 | Toggle project servers by managing `disabledMcpjsonServers` array in `.claude/settings.local.json` (Strategy B — does not modify `.mcp.json`) | P0 | Done |
| FR-6 | Show restart notification after any toggle operation | P0 | Done |
| FR-7 | Display enterprise managed servers as read-only (no toggle) | P1 | Done |
| FR-8 | Provide a manual refresh button in the TreeView toolbar | P0 | Done |
| FR-9 | Show a welcome view when no MCP servers are found | P1 | Done |
| FR-10 | Provide context menu enable/disable actions (in addition to checkboxes) | P1 | Done |
| FR-11 | "Edit Config" context menu action to open the source JSON file | P1 | Done |
| FR-12 | Read installed plugins from `~/.claude/plugins/installed_plugins.json` and display MCP-bearing plugin servers in the tree | P0 | Done |
| FR-13 | Filter plugins to only show those with an `.mcp.json` in their install directory (skip non-MCP plugins) | P0 | Done |
| FR-14 | Toggle plugin-provided servers via `enabledPlugins` boolean map in `~/.claude/settings.json` (Strategy C) | P0 | Done |
| FR-15 | Map plugin scopes to tree groups: global plugins → "Global MCPs", project plugins → "Local MCPs" | P1 | Done |
| FR-16 | Show plugin ID in tooltip for plugin-sourced servers | P1 | Done |
| FR-17 | Deduplicate plugin installations to avoid showing the same plugin servers multiple times | P1 | Done |
| FR-18 | Handle both v1 and v2 plugin registry formats defensively | P1 | Done |
| FR-19 | Tier 1 health checks: auto-run on refresh — binary existence check (stdio) and endpoint reachability (HTTP) | P0 | Done |
| FR-20 | Tier 2 health checks: user-initiated deep check — full MCP SDK handshake with ping, tool listing, and server info | P0 | Done |
| FR-21 | Health-aware icons on server items (pass-filled, warning, error, loading~spin, etc.) | P0 | Done |
| FR-22 | Health status and latency in server description text | P1 | Done |
| FR-23 | Rich markdown tooltip with full health details (status, latency, tool count, server version, error, timestamp) | P1 | Done |
| FR-24 | "Check Health" context menu action for single enabled server (Tier 2) | P1 | Done |
| FR-25 | "Check All Health" toolbar button for deep-checking all enabled servers with progress notification | P1 | Done |
| FR-26 | Health check result caching with 5-minute default expiry | P1 | Done |
| FR-27 | Configurable auto health check mode: "none", "httpOnly", "all" | P1 | Done |
| FR-28 | Configurable health check timeout (1s–120s, default 15s) | P1 | Done |
| FR-29 | Settings group in TreeView — collapsible section showing extension and Claude Code settings | P1 | Done |
| FR-30 | Edit extension settings via QuickPick (enum) or InputBox (number) from context menu | P1 | Done |
| FR-31 | Claude Code ENABLE_TOOL_SEARCH env var management via TreeView setting (auto/true/false) | P1 | Done |
| FR-32 | Settings persistence in `~/.claude/mcp-manager-settings.json` (extension) and `~/.claude/settings.json` env map (Claude Code) | P1 | Done |
| FR-33 | Sort servers within each scope group by health status priority (healthy first, errors last) with alphabetical tiebreaking | P1 | Done |

## Config File Locations

| Scope | File | Writable? |
|-------|------|-----------|
| Project (shared) | `.mcp.json` at workspace root | Read-only (toggle via settings) |
| User (global) | `~/.claude.json` → `mcpServers` | Yes |
| Local (per-project) | `~/.claude.json` → `projects["/path"].mcpServers` | Yes |
| Managed (enterprise) | Platform-specific path | Read-only |
| Toggle state (project) | `.claude/settings.local.json` → `disabledMcpjsonServers` | Yes |
| Plugin registry | `~/.claude/plugins/installed_plugins.json` | Read-only |
| Plugin toggle state | `~/.claude/settings.json` → `enabledPlugins` | Yes |
| Plugin MCP config | `{pluginInstallPath}/.mcp.json` | Read-only |
| Extension settings | `~/.claude/mcp-manager-settings.json` | Yes |
| Claude Code env vars | `~/.claude/settings.json` → `env` | Yes |

## Toggle Strategies

| Strategy | Scope | Mechanism | Target File |
|----------|-------|-----------|-------------|
| **A (key-move)** | User / Local | Move between `mcpServers` ↔ `_disabled_mcpServers` | `~/.claude.json` |
| **B (settings array)** | Project | Add/remove from `disabledMcpjsonServers[]` | `.claude/settings.local.json` |
| **C (boolean map)** | Plugins | Set `enabledPlugins[pluginId] = true/false` | `~/.claude/settings.json` |

Dispatch order in `toggleServer()`: managed → warn; `pluginId` present → Strategy C; project scope → Strategy B; user/local → Strategy A.

## Health Check Architecture

| Tier | Trigger | Speed | Method | Statuses |
|------|---------|-------|--------|----------|
| **Tier 1** | Auto on refresh | Fast (1–5s) | `which` (stdio), HEAD request (HTTP) | BinaryFound, CommandNotFound, Reachable, Unreachable, AuthFailed |
| **Tier 2** | User-initiated | Slower (2–15s) | MCP SDK Client: connect → ping → listTools | Healthy, Degraded, Error + all Tier 1 statuses |

- Results cached by `name:scope` key, 5-minute expiry
- Progressive UI updates — each server updates independently as its check completes
- Tier 2 uses `vscode.window.withProgress` for "Check All Health" feedback
- Error classification: 401/403 → AuthFailed, ENOENT → CommandNotFound, ECONNREFUSED → Unreachable

## Technical Constraints

- VS Code engine `^1.80.0` (required for `TreeItemCheckboxState`)
- Must use object form for `checkboxState` (VS Code bug with bare enum value `0`)
- Must set `manageCheckboxStateManually: true` on TreeView
- No hot-reload in Claude Code — must prompt user to restart
- JSON writes must preserve all existing keys (read-modify-write pattern)
- `~/.claude/settings.json` is shared (contains `permissions`, `enabledPlugins`, `env`, etc.) — must merge carefully
- Plugin `installPath` may use `~` prefix — must expand to `os.homedir()`
- Plugin `.mcp.json` may use wrapped (`{ mcpServers: {...} }`) or flat format — handle both
- esbuild CJS bundler; `@modelcontextprotocol/sdk/client/sse.js` must be external (top-level await breaks CJS)
- MCP SDK `Client` close may throw — must be caught gracefully in health checks

## Success Criteria

- User can see all configured MCP servers (including plugin-provided) in the sidebar within 1 second of activation
- User can toggle any non-managed server with a single click
- Config files are correctly updated after toggle (verified by manual inspection)
- No data loss — disabled servers are fully recoverable by re-enabling
- Extension gracefully handles missing/malformed config files without crashing
- Plugin servers appear in correct groups (global plugins in "Global MCPs", project plugins in "Local MCPs")
- Toggling a plugin server updates `~/.claude/settings.json` without clobbering other keys
- Non-MCP plugins do not appear in the tree
- One broken plugin entry does not prevent other plugins from loading
- Tier 1 health checks complete within 5 seconds of refresh
- Tier 2 health checks correctly identify healthy, degraded, and erroring servers
- Health status icons and descriptions update progressively as checks complete
- Settings are editable from the sidebar and persist across sessions
- Servers within each scope group are sorted by health status (healthy on top, errors on bottom), re-sorting as health check results arrive
- 206 tests pass across 6 test files with full coverage of all services, models, and providers
