# MCP Manager for VS Code — Product Requirements Document

## Version: 1.1 (MVP + Plugin Integration)

## Problem Statement

Claude Code uses MCP (Model Context Protocol) servers configured across multiple JSON files and installed plugins, but provides no GUI to manage them. Users must manually edit JSON to enable/disable servers and plugins, which is error-prone and tedious. There is no native `disabled` flag in the MCP config schema, and plugin toggles require knowing the `enabledPlugins` map format.

## Target Users

- Developers using Claude Code in VS Code who have multiple MCP servers configured
- Teams sharing project-level MCP configs via `.mcp.json` who want personal toggle preferences
- Users with Claude Code plugins (e.g., Playwright, Supabase, GitHub) that provide MCP servers

## Goals

1. Provide a visual sidebar to see all MCP servers across all config scopes at a glance
2. Enable one-click toggling of individual servers without manual JSON editing
3. Avoid modifying git-tracked `.mcp.json` for personal toggle preferences
4. Preserve server configurations non-destructively (no data loss on disable)
5. Display and toggle plugin-provided MCP servers alongside hand-configured ones

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

## Toggle Strategies

| Strategy | Scope | Mechanism | Target File |
|----------|-------|-----------|-------------|
| **A (key-move)** | User / Local | Move between `mcpServers` ↔ `_disabled_mcpServers` | `~/.claude.json` |
| **B (settings array)** | Project | Add/remove from `disabledMcpjsonServers[]` | `.claude/settings.local.json` |
| **C (boolean map)** | Plugins | Set `enabledPlugins[pluginId] = true/false` | `~/.claude/settings.json` |

Dispatch order in `toggleServer()`: managed → warn; `pluginId` present → Strategy C; project scope → Strategy B; user/local → Strategy A.

## Technical Constraints

- VS Code engine `^1.80.0` (required for `TreeItemCheckboxState`)
- Must use object form for `checkboxState` (VS Code bug with bare enum value `0`)
- Must set `manageCheckboxStateManually: true` on TreeView
- No hot-reload in Claude Code — must prompt user to restart
- JSON writes must preserve all existing keys (read-modify-write pattern)
- `~/.claude/settings.json` is shared (contains `permissions`, `enabledPlugins`, etc.) — must merge carefully
- Plugin `installPath` may use `~` prefix — must expand to `os.homedir()`
- Plugin `.mcp.json` may use wrapped (`{ mcpServers: {...} }`) or flat format — handle both

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

## Plans & Research

Detailed research and implementation plans are stored in Claude global settings:
- **Research**: `~/.claude/plans/research/plugin-toggle-integration-research.md`
- **Implementation**: `~/.claude/plans/implementation/plugin-toggle-integration-implementation.md`
