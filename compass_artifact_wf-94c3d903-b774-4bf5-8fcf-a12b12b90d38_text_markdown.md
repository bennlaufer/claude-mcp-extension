# Building a Claude Code MCP toggle extension for VS Code

**Claude Code stores MCP configurations across multiple JSON files with no native enable/disable flag**, making a toggle extension both valuable and achievable through a well-defined workaround pattern. This report provides every schema, file path, code example, and architectural decision needed to build the extension using Claude Code as the development agent. The recommended approach uses VS Code's TreeView with checkboxes, watches config files for changes, and implements non-destructive toggling by moving disabled servers to a `_disabled_mcpServers` key that Claude Code ignores.

---

## Where Claude Code stores MCP configurations

Claude Code uses a **multi-scope configuration hierarchy** across several files. Understanding this is the foundation of the entire extension.

| Scope | File path | Purpose | Shared via git? |
|-------|-----------|---------|-----------------|
| **Project (shared)** | `.mcp.json` at project root | Team-shared MCP servers | ✅ Yes |
| **Local (personal, per-project)** | `~/.claude.json` → `projects."/path/to/project".mcpServers` | Private project servers | ❌ No |
| **User (global)** | `~/.claude.json` → top-level `mcpServers` key | Servers for all projects | ❌ No |
| **Enterprise managed** | `/Library/Application Support/ClaudeCode/managed-mcp.json` (macOS), `/etc/claude-code/managed-mcp.json` (Linux) | IT-administered servers | N/A |

The **settings files** (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`) do **not** define MCP servers — they only control approval lists via `enabledMcpjsonServers`, `disabledMcpjsonServers`, and `enableAllProjectMcpServers`. This distinction is critical: the extension must read/write `.mcp.json` and `~/.claude.json` for server definitions, but can leverage settings files for approval-based toggling of project servers.

**Scope precedence** (highest to lowest): Local → Project → User. When servers share names across scopes, higher-scoped entries override lower ones.

The JSON schema for each MCP server entry is consistent across all files:

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": { "API_KEY": "${MY_API_KEY}" }
    },
    "remote-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

Valid `type` values are `"stdio"` (default, local process), `"http"` (remote), and `"sse"` (deprecated). Environment variable expansion supports `${VAR}` and `${VAR:-default}` syntax in `command`, `args`, `env`, `url`, and `headers` fields.

---

## The toggle mechanism: no native flag, but a clean workaround exists

**There is no native `disabled` boolean field in Claude Code's MCP config schema.** This is an open feature request (GitHub issues #17921, #4879, #5722) with no implementation as of February 2026. The extension must implement its own toggle mechanism.

The **recommended non-destructive toggle pattern** uses a dual-key approach. For both `.mcp.json` and `~/.claude.json`, move disabled server entries from `mcpServers` to a custom `_disabled_mcpServers` key. Claude Code ignores unknown top-level keys, so disabled servers are preserved but invisible to Claude:

```json
{
  "mcpServers": {
    "active-server": { "type": "stdio", "command": "npx", "args": ["..."] }
  },
  "_disabled_mcpServers": {
    "paused-server": { "type": "http", "url": "https://mcp.example.com" }
  }
}
```

For **project-scoped `.mcp.json` servers specifically**, there's an alternative: add server names to `disabledMcpjsonServers` in `.claude/settings.local.json`. This uses Claude Code's native approval system and avoids modifying the shared `.mcp.json` file:

```json
{
  "disabledMcpjsonServers": ["playwright", "filesystem"]
}
```

The extension should support **both strategies** — the `_disabled_mcpServers` move pattern for global/user servers in `~/.claude.json`, and the `disabledMcpjsonServers` settings approach for project servers. This keeps `.mcp.json` (which is git-tracked) untouched while still allowing personal toggle preferences.

**After any configuration change, Claude Code must be restarted** — there is no hot-reload mechanism. The extension should display a notification prompting the user to restart Claude Code after toggling.

---

## VS Code extension architecture and project setup

Scaffold the project with `npx --package yo --package generator-code -- yo code`, selecting TypeScript. The recommended file structure separates concerns cleanly:

```
src/
├── extension.ts                  # activate/deactivate entry point
├── providers/
│   └── mcpTreeDataProvider.ts    # TreeDataProvider with grouped items
├── models/
│   └── mcpItems.ts              # McpGroupItem and McpServerItem classes
├── services/
│   ├── configService.ts         # Read/write JSON config files
│   └── configWatcher.ts         # FileSystemWatcher for live updates
└── utils/
    └── claudeDetection.ts       # Detect Claude Code CLI/extension
```

The `package.json` `contributes` section registers the sidebar view container, tree view, commands, context menus, and welcome views. Set `engines.vscode` to `^1.80.0` minimum to access the `TreeItemCheckboxState` API. Since VS Code 1.74, activation events are auto-generated for contributed views, so `activationEvents` can be left as `[]`.

The complete `package.json` contributes block should declare:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "mcp-manager",
        "title": "MCP Manager",
        "icon": "media/mcp-icon.svg"
      }]
    },
    "views": {
      "mcp-manager": [{
        "id": "mcpServersView",
        "name": "MCP Servers",
        "contextualTitle": "MCP Manager"
      }]
    },
    "viewsWelcome": [{
      "view": "mcpServersView",
      "contents": "No MCP servers found.\n[Add MCP Server](command:mcpManager.addServer)\n[Learn about MCP](https://modelcontextprotocol.io)",
      "when": "!mcpManager.hasServers"
    }],
    "commands": [
      { "command": "mcpManager.refresh", "title": "Refresh", "icon": "$(refresh)" },
      { "command": "mcpManager.enable", "title": "Enable Server", "icon": "$(eye)" },
      { "command": "mcpManager.disable", "title": "Disable Server", "icon": "$(eye-closed)" },
      { "command": "mcpManager.editConfig", "title": "Edit Config", "icon": "$(edit)" },
      { "command": "mcpManager.addServer", "title": "Add Server", "icon": "$(add)" },
      { "command": "mcpManager.removeServer", "title": "Remove Server", "icon": "$(trash)" }
    ],
    "menus": {
      "view/title": [
        { "command": "mcpManager.refresh", "when": "view == mcpServersView", "group": "navigation" },
        { "command": "mcpManager.addServer", "when": "view == mcpServersView", "group": "navigation" }
      ],
      "view/item/context": [
        { "command": "mcpManager.disable", "when": "view == mcpServersView && viewItem == mcpServer.enabled", "group": "inline" },
        { "command": "mcpManager.enable", "when": "view == mcpServersView && viewItem == mcpServer.disabled", "group": "inline" },
        { "command": "mcpManager.editConfig", "when": "view == mcpServersView && viewItem =~ /^mcpServer/", "group": "2_manage@1" },
        { "command": "mcpManager.removeServer", "when": "view == mcpServersView && viewItem =~ /^mcpServer/", "group": "3_destructive@1" }
      ]
    }
  }
}
```

The `viewItem` matching uses `contextValue` set on each TreeItem — `"mcpServer.enabled"` or `"mcpServer.disabled"` — so that the enable button only appears on disabled items and vice versa.

---

## TreeView implementation with checkboxes and grouped sections

The TreeView needs two top-level collapsible groups ("Project MCPs" and "Global MCPs") with individual server items underneath. Use `vscode.window.createTreeView` (not `registerTreeDataProvider`) to get the TreeView instance required for checkbox event handling.

The TreeItem model classes:

```typescript
export class McpGroupItem extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly groupType: 'project' | 'global') {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'mcpGroup';
    this.iconPath = new vscode.ThemeIcon(groupType === 'project' ? 'folder' : 'globe');
  }
}

export class McpServerItem extends vscode.TreeItem {
  constructor(public readonly server: McpServerConfig, public readonly scope: 'project' | 'global') {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    this.description = server.command || server.url;
    this.contextValue = server.enabled ? 'mcpServer.enabled' : 'mcpServer.disabled';
    this.checkboxState = {
      state: server.enabled ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: server.enabled ? 'Click to disable' : 'Click to enable'
    };
    this.iconPath = new vscode.ThemeIcon('server-process',
      server.enabled ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('disabledForeground'));
  }
}
```

**Always use the object form** `{ state: TreeItemCheckboxState.Unchecked }` rather than the bare enum value `0`, which had a historical bug where VS Code interpreted it as "no checkbox." Set `manageCheckboxStateManually: true` in the `createTreeView` options to prevent parent/child checkbox cascading — each MCP server's toggle state must be independent.

The TreeDataProvider's `getChildren` method returns `McpGroupItem` instances at root level, and `McpServerItem` arrays when expanding each group. Listen for toggle events via `treeView.onDidChangeCheckboxState`, which provides `[item, newState]` pairs for each toggled checkbox.

For **status indication**, use `ThemeIcon` with `ThemeColor` to visually differentiate states. `testing.iconPassed` renders green, `disabledForeground` renders dimmed gray. Useful codicon pairs for toggle UX include `eye`/`eye-closed`, `pass-filled`/`circle-large-outline`, and `check`/`dash`. Rich Markdown tooltips can show server details including command, args, transport type, and current status with codicon rendering via `tooltip.supportThemeIcons = true`.

A **TreeView badge** shows at-a-glance status: `treeView.badge = { value: enabledCount, tooltip: '5 of 8 servers active' }`.

---

## File watching and config persistence

Use `vscode.workspace.createFileSystemWatcher` for project-level files (`.mcp.json`, `.claude/settings.local.json`) with glob patterns like `**/.mcp.json`. For global files outside the workspace (`~/.claude.json`), use `RelativePattern` with a URI base path — string glob patterns only watch workspace files.

```typescript
// Watch project config
const projectWatcher = vscode.workspace.createFileSystemWatcher('**/.mcp.json');
projectWatcher.onDidChange(() => refreshTree('project'));

// Watch global config (outside workspace)
const homeDir = os.homedir();
const globalConfigDir = vscode.Uri.file(homeDir);
const globalWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(globalConfigDir, '.claude.json')
);
globalWatcher.onDidChange(() => refreshTree('global'));
```

For reading and writing JSON, use `vscode.workspace.fs.readFile` and `writeFile` with `TextDecoder`/`TextEncoder`. The toggle operation reads the config, moves the server entry between `mcpServers` and `_disabled_mcpServers` keys, then writes back with `JSON.stringify(data, null, 2)` to preserve formatting. Claude Code automatically creates timestamped backups of config files, but the extension should still implement its own error handling and potentially a brief debounce on file writes to avoid race conditions with Claude Code's own file access.

---

## Integrating with Claude Code's ecosystem

The **Claude Code VS Code extension** (`anthropic.claude-code`, 2M+ installs) does **not** expose a public extension API or programmable commands for sending prompts. However, the extension can be detected and its sidebar opened:

```typescript
const claudeExt = vscode.extensions.getExtension('anthropic.claude-code');
const isInstalled = claudeExt !== undefined;
// Open Claude sidebar:
await vscode.commands.executeCommand('claude-vscode.sidebar.open');
```

The **Claude Code CLI** is the primary programmatic integration point. Key MCP management commands that the extension can invoke via `child_process`:

- **`claude mcp list`** — verify current server state
- **`claude mcp add-json <name> '<json>'`** — add servers programmatically
- **`claude mcp remove <name>`** — remove servers
- **`claude mcp reset-project-choices`** — reset approval state
- **`claude --version`** — detect installation and version

For detecting the CLI: run `which claude` (Unix) or `where claude` (Windows) via `child_process.exec`. The extension should gracefully degrade if Claude Code isn't installed, showing a welcome view with installation instructions.

**After toggling MCPs, notify the user to restart Claude Code.** There is no hot-reload mechanism. A community project (`mcp-hot-reload`) exists as a proxy wrapper, but the standard approach is restart. Show a notification with an action button:

```typescript
const action = await vscode.window.showInformationMessage(
  'MCP configuration updated. Restart Claude Code for changes to take effect.',
  'Restart Claude Code'
);
```

---

## Development workflow: building this with Claude Code

Start by scaffolding with `yo code`, then create a `CLAUDE.md` file at the project root describing the extension's architecture, target VS Code API version (1.80+), the MCP config schema, and the toggle strategy. This gives Claude Code persistent context across sessions.

**Effective prompting sequence for Claude Code:**

1. "Set up the package.json with view container, tree view, commands, and menu contributions for an MCP manager sidebar" — let Claude handle the full contributes block
2. "Implement McpGroupItem and McpServerItem TreeItem classes with checkbox support and ThemeIcon status indicators" — reference specific API classes
3. "Create the McpTreeDataProvider with two groups (Project MCPs, Global MCPs), checkbox toggle handling, and refresh support" — one focused module
4. "Build ConfigService to read/write `.mcp.json` and `~/.claude.json`, implementing the `_disabled_mcpServers` toggle pattern" — handle both scopes
5. "Add FileSystemWatcher for `.mcp.json` and `~/.claude.json`, wiring change events to tree refresh" — include RelativePattern for global config
6. "Wire everything together in extension.ts with command registration, Claude Code detection, and restart notifications"

Use **`@src/extension.ts`** mentions to give Claude focused context on specific files. Test iteratively using F5 to launch the Extension Development Host after each major component. Claude Code can't directly test the extension UI, so review generated code carefully, especially `when` clause expressions and `contextValue` matching in menus.

**Key pitfalls to watch for**: VS Code extensions run in Node.js (no DOM access), `FileSystemWatcher` glob patterns don't work outside the workspace without `RelativePattern`, the `TreeItemCheckboxState.Unchecked` value `0` is falsy and requires the object form, and `manageCheckboxStateManually` had a regression in VS Code 1.83 and again in 1.95.0 (fixed in 1.95.2+).

---

## Conclusion

The extension architecture is straightforward: **two config files** (`.mcp.json` for project, `~/.claude.json` for global), **one TreeDataProvider** with grouped sections and native checkboxes, and a **dual toggle strategy** — the `_disabled_mcpServers` key-move pattern for global servers and the `disabledMcpjsonServers` settings approach for project servers. The absence of a native `disabled` flag in Claude Code's schema is the core design constraint, but the community-proven workaround of parking configs in an ignored key is robust and non-destructive. Claude Code's CLI commands (`claude mcp list/add-json/remove`) provide a reliable secondary integration channel for verification and advanced operations. The main UX challenge is the restart requirement after config changes — surface this clearly with notifications and consider adding a status bar item showing `$(plug) MCP: 5/8` for persistent visibility into the active server count.