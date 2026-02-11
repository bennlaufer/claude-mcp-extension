# MCP Manager — VS Code Extension

## Architecture

VS Code extension that manages Claude Code MCP server configurations via a sidebar TreeView. Supports hand-configured MCP servers (project, user, local, managed) and plugin-provided MCP servers with one-click toggle.

### File Structure
```
src/
├── extension.ts              # Activation, command registration, wiring
├── types.ts                  # Shared interfaces (McpServerEntry, McpScope, plugin types, etc.)
├── models/
│   └── mcpItems.ts           # TreeItem subclasses (McpGroupItem, McpServerItem)
├── providers/
│   └── mcpTreeDataProvider.ts # TreeDataProvider implementation
└── services/
    └── configService.ts      # Read/write config files, toggle logic (Strategies A/B/C)
```

### Config Files
- **`.mcp.json`** (workspace root): Project-scoped servers. Read-only — toggled via settings.
- **`~/.claude.json`**: Global/user + local/per-project servers. Writable — toggle by moving entries between `mcpServers` and `_disabled_mcpServers`.
- **`.claude/settings.local.json`** (workspace): Stores `disabledMcpjsonServers` array for project server toggles.
- **`~/.claude/plugins/installed_plugins.json`**: Plugin registry. Read-only — lists installed plugins with scope, installPath, version.
- **`~/.claude/settings.json`**: Plugin toggle state via `enabledPlugins` boolean map. Writable.
- **`{pluginInstallPath}/.mcp.json`**: Per-plugin MCP server configs. Read-only — used to discover plugin-provided servers.
- **Managed**: Platform-specific enterprise config. Read-only.

### Toggle Strategies
- **Strategy A (key-move)**: For `~/.claude.json` servers — move between `mcpServers` and `_disabled_mcpServers`.
- **Strategy B (settings array)**: For `.mcp.json` servers — add/remove name from `disabledMcpjsonServers` in `.claude/settings.local.json`.
- **Strategy C (boolean map)**: For plugin-provided servers — set `enabledPlugins[pluginId] = true/false` in `~/.claude/settings.json`. Toggles entire plugin (all servers from that plugin).

### Plugin Integration
- Reads `~/.claude/plugins/installed_plugins.json` to discover installed plugins
- Filters to MCP-bearing plugins only (checks for `.mcp.json` in install directory)
- Handles both v1 (object) and v2 (array) plugin registry formats
- Maps plugin scope to extension scope: "global" plugins → `user`, "project" plugins → `local`
- Ancestor-path check: project plugins installed at an ancestor of the workspace show as `user` scope
- Deduplicates by `pluginId:scope` to avoid duplicate entries
- Plugin servers carry `pluginId` field on `McpServerEntry` to route to Strategy C
- Default is enabled — absent from `enabledPlugins` map means enabled

### Plans & Research
- **Research**: `~/.claude/plans/research/plugin-toggle-integration-research.md`
- **Implementation**: `~/.claude/plans/implementation/plugin-toggle-integration-implementation.md`

### Key Technical Notes
- VS Code engine `^1.80.0` required for `TreeItemCheckboxState`
- Must use object form `{ state: TreeItemCheckboxState.Checked }` (bare `0` is falsy — VS Code bug)
- Must set `manageCheckboxStateManually: true` on TreeView
- esbuild bundler, CommonJS output
- All config reads are parallel via `Promise.all` (5 sources: project, user, local, managed, plugins)
- Per-plugin processing wrapped in try/catch for robustness — one broken plugin doesn't block others
- `readJson<T>()` returns `undefined` on ENOENT or parse errors (defensive)
- `writeJson()` does read-modify-write to preserve existing keys in shared config files
