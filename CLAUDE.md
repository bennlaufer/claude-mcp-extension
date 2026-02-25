# MCP Manager — VS Code Extension

## Architecture

VS Code extension that manages Claude Code MCP server configurations via a sidebar TreeView. Supports hand-configured MCP servers (project, user, local, managed) and plugin-provided MCP servers with one-click toggle. Includes two-tier health checks, extension settings, and Claude Code environment settings.

### File Structure
```
src/
├── extension.ts                          # Activation, command registration, wiring
├── types.ts                              # Shared interfaces, enums, type guards, setting definitions
├── models/
│   ├── mcpItems.ts                       # TreeItem subclasses (groups, servers, settings)
│   └── mcpItems.test.ts                  # 74 tests
├── providers/
│   ├── mcpTreeDataProvider.ts            # TreeDataProvider + health check orchestration
│   └── mcpTreeDataProvider.test.ts       # 37 tests
└── services/
    ├── configService.ts                  # Read/write config files, toggle logic (Strategies A/B/C)
    ├── settingsService.ts                # Extension settings persistence
    ├── settingsService.test.ts           # 8 tests
    ├── claudeCodeSettingsService.ts      # Claude Code env var settings
    ├── claudeCodeSettingsService.test.ts # 13 tests
    ├── healthCheckService.ts             # Two-tier health check system
    └── healthCheckService.test.ts        # 57 tests
src/types.test.ts                         # 17 tests
```

### Config Files
- **`.mcp.json`** (workspace root): Project-scoped servers. Read-only — toggled via settings.
- **`~/.claude.json`**: Global/user + local/per-project servers. Writable — toggle by moving entries between `mcpServers` and `_disabled_mcpServers`.
- **`.claude/settings.local.json`** (workspace): Stores `disabledMcpjsonServers` array for project server toggles.
- **`~/.claude/plugins/installed_plugins.json`**: Plugin registry. Read-only — lists installed plugins with scope, installPath, version.
- **`~/.claude/settings.json`**: Plugin toggle state via `enabledPlugins` boolean map + Claude Code env vars via `env` map. Writable.
- **`{pluginInstallPath}/.mcp.json`**: Per-plugin MCP server configs. Read-only — used to discover plugin-provided servers.
- **`~/.claude/mcp-manager-settings.json`**: Extension settings persistence (autoHealthCheck, healthCheckTimeoutMs).
- **Managed**: Platform-specific enterprise config. Read-only.

### Toggle Strategies
- **Strategy A (key-move)**: For `~/.claude.json` servers — move between `mcpServers` and `_disabled_mcpServers`.
- **Strategy B (settings array)**: For `.mcp.json` servers — add/remove name from `disabledMcpjsonServers` in `.claude/settings.local.json`.
- **Strategy C (boolean map)**: For plugin-provided servers — set `enabledPlugins[pluginId] = true/false` in `~/.claude/settings.json`. Toggles entire plugin (all servers from that plugin).

### Health Check System
Two-tier hybrid architecture:
- **Tier 1 (auto)**: Runs automatically on tree refresh. Lightweight checks — `which` for stdio binaries, HEAD request for HTTP endpoints. Configurable via `autoHealthCheck` setting ("none", "httpOnly", "all").
- **Tier 2 (manual)**: User-initiated via context menu or "Check All Health" button. Full MCP SDK handshake — creates `Client`, connects transport, pings, lists tools. Configurable timeout via `healthCheckTimeoutMs` setting (default 15s).
- **Caching**: Results cached by `name:scope` key with 5-minute default expiry.
- **Health statuses** (10): Unknown, BinaryFound, CommandNotFound, Reachable, Unreachable, AuthFailed, Checking, Healthy, Degraded, Error.
- **Error classification** (Tier 2): 401/403 → AuthFailed, ENOENT → CommandNotFound, ECONNREFUSED → Unreachable.
- **UI integration**: Health-aware icons (pass-filled, warning, error, loading~spin), status in description, full details in rich markdown tooltip.
- **Sort order**: Servers within each scope group are sorted by health priority (healthy/reachable first → checking → unknown → error/offline), with alphabetical tiebreaking. Priority defined by `HEALTH_SORT_PRIORITY` constant in `types.ts` (`Record<HealthStatus, number>` ensures compile-time exhaustiveness). Servers with no health result yet sort as "unknown" priority via `HEALTH_SORT_PRIORITY_DEFAULT`.

### Settings
Two categories displayed in a collapsible "Settings" group in the tree:

**Extension settings** (`SettingsService` → `~/.claude/mcp-manager-settings.json`):
- `autoHealthCheck`: "none" | "httpOnly" | "all" (default: "all") — controls Tier 1 auto-checks
- `healthCheckTimeoutMs`: 1000–120000 (default: 15000) — Tier 2 timeout

**Claude Code settings** (`ClaudeCodeSettingsService` → `~/.claude/settings.json` `env` map):
- `toolSearchMode`: "auto" | "true" | "false" (default: "auto") — maps to `ENABLE_TOOL_SEARCH` env var
- Removes env var when value matches default (keeps file clean)

### Commands
| Command | Description |
|---------|-------------|
| `mcpManager.refresh` | Refresh tree data + trigger Tier 1 checks |
| `mcpManager.enableServer` | Toggle server to enabled (context menu) |
| `mcpManager.disableServer` | Toggle server to disabled (context menu) |
| `mcpManager.editConfig` | Open source config file in editor |
| `mcpManager.checkHealth` | Tier 2 deep health check (single server) |
| `mcpManager.checkAllHealth` | Tier 2 deep check all enabled servers (with progress) |
| `mcpManager.editSetting` | Edit extension setting via QuickPick/InputBox |
| `mcpManager.editClaudeCodeSetting` | Edit Claude Code setting via QuickPick |

### TreeView Structure
```
mcp-manager (activity bar)
└── mcpServersView
    ├── Project MCPs (McpGroupItem)
    │   └── server-name (McpServerItem) [checkbox, health icon]
    ├── Global MCPs (McpGroupItem)
    │   └── ...
    ├── Local MCPs (McpGroupItem)
    │   └── ...
    ├── Managed MCPs (McpGroupItem) [read-only, no checkboxes]
    │   └── ...
    └── Settings (SettingsGroupItem) [collapsed by default]
        ├── Tool Search Mode (ClaudeCodeSettingItem)
        ├── Auto Health Check (SettingItem)
        └── Health Check Timeout (SettingItem)
```

### Plugin Integration
- Reads `~/.claude/plugins/installed_plugins.json` to discover installed plugins
- Filters to MCP-bearing plugins only (checks for `.mcp.json` in install directory)
- Handles both v1 (object) and v2 (array) plugin registry formats
- Maps plugin scope to extension scope: "global" plugins → `user`, "project" plugins → `local`
- Ancestor-path check: project plugins installed at an ancestor of the workspace show as `user` scope
- Deduplicates by `pluginId:scope` to avoid duplicate entries
- Plugin servers carry `pluginId` field on `McpServerEntry` to route to Strategy C
- Default is enabled — absent from `enabledPlugins` map means enabled

### Key Technical Notes
- VS Code engine `^1.80.0` required for `TreeItemCheckboxState`
- Must use object form `{ state: TreeItemCheckboxState.Checked }` (bare `0` is falsy — VS Code bug)
- Must set `manageCheckboxStateManually: true` on TreeView
- esbuild bundler, CommonJS output; `@modelcontextprotocol/sdk/client/sse.js` must be external (top-level await breaks CJS)
- All config reads are parallel via `Promise.all` (5 sources: project, user, local, managed, plugins)
- Per-plugin processing wrapped in try/catch for robustness — one broken plugin doesn't block others
- `readJson<T>()` returns `undefined` on ENOENT or parse errors (defensive)
- `writeJson()` does read-modify-write to preserve existing keys in shared config files
- Tier 1 health checks fire non-blocking after refresh; Tier 2 uses `vscode.window.withProgress` for UI feedback
- Uses `which` package for stdio binary detection (Tier 1) and MCP SDK `Client`/`StdioClientTransport`/`SSEClientTransport` for Tier 2

### Dependencies
- `@modelcontextprotocol/sdk` — MCP Client, transports (Tier 2 health checks)
- `which` — Binary path lookup (Tier 1 stdio checks)

### Testing
- **Framework**: Vitest v4 with `globals: true`, node environment
- **206 tests** across 6 test files
- **Critical pattern**: `vi.mock` factories are hoisted — variables used inside must be defined via `vi.hoisted()`
- **Mock constructors**: Use `class MockFoo { ... }` syntax inside `vi.mock()` factories (not `vi.fn().mockImplementation`)
- **vscode mock**: Class-based mocks for EventEmitter, TreeItem, ThemeIcon, ThemeColor, MarkdownString
