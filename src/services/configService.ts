import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  McpServerEntry,
  McpServerConfig,
  McpScope,
  ClaudeGlobalConfig,
  McpJsonConfig,
  ManagedMcpConfig,
  SettingsLocal,
  InstalledPluginsFile,
  PluginInstallation,
  ClaudeSettings,
} from "../types";

export class ConfigService {
  /** Read a JSON file, returning undefined if missing or malformed */
  private async readJson<T>(filePath: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      vscode.window.showWarningMessage(`MCP Manager: Failed to parse ${filePath}`);
      return undefined;
    }
  }

  /** Write JSON back, preserving formatting */
  private async writeJson(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  // --- Path helpers ---

  private get claudeGlobalPath(): string {
    return path.join(os.homedir(), ".claude.json");
  }

  private get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private get mcpJsonPath(): string | undefined {
    const root = this.workspaceRoot;
    return root ? path.join(root, ".mcp.json") : undefined;
  }

  private get settingsLocalPath(): string | undefined {
    const root = this.workspaceRoot;
    return root ? path.join(root, ".claude", "settings.local.json") : undefined;
  }

  private get managedConfigPath(): string {
    if (process.platform === "darwin") {
      return "/Library/Application Support/ClaudeCode/managed-mcp.json";
    } else if (process.platform === "win32") {
      return path.join(
        process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "ClaudeCode",
        "managed-mcp.json"
      );
    }
    // Linux
    return "/etc/claude-code/managed-mcp.json";
  }

  private get installedPluginsPath(): string {
    return path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  }

  private get claudeSettingsPath(): string {
    return path.join(os.homedir(), ".claude", "settings.json");
  }

  private pluginMcpConfigPath(installPath: string): string {
    return path.join(installPath, ".mcp.json");
  }

  // --- Reading servers ---

  /** Load all MCP servers from all config sources */
  async getAllServers(): Promise<McpServerEntry[]> {
    const results: McpServerEntry[] = [];

    // Read in parallel
    const [projectServers, userServers, localServers, managedServers, pluginServers] = await Promise.all([
      this.readProjectServers(),
      this.readUserServers(),
      this.readLocalServers(),
      this.readManagedServers(),
      this.readPluginServers(),
    ]);

    results.push(...projectServers, ...userServers, ...localServers, ...managedServers, ...pluginServers);
    return results;
  }

  /** Read `.mcp.json` project servers, cross-referencing disabled list */
  private async readProjectServers(): Promise<McpServerEntry[]> {
    const mcpPath = this.mcpJsonPath;
    if (!mcpPath) {
      return [];
    }

    const [mcpJson, settingsLocal] = await Promise.all([
      this.readJson<McpJsonConfig>(mcpPath),
      this.settingsLocalPath ? this.readJson<SettingsLocal>(this.settingsLocalPath) : undefined,
    ]);

    if (!mcpJson?.mcpServers) {
      return [];
    }

    const disabledSet = new Set(settingsLocal?.disabledMcpjsonServers ?? []);

    return Object.entries(mcpJson.mcpServers).map(([name, config]) => ({
      name,
      config,
      scope: "project" as McpScope,
      enabled: !disabledSet.has(name),
      configFilePath: mcpPath,
    }));
  }

  /** Read `~/.claude.json` top-level `mcpServers` (user/global scope) */
  private async readUserServers(): Promise<McpServerEntry[]> {
    const globalConfig = await this.readJson<ClaudeGlobalConfig>(this.claudeGlobalPath);
    if (!globalConfig) {
      return [];
    }

    const results: McpServerEntry[] = [];

    // Enabled servers
    if (globalConfig.mcpServers) {
      for (const [name, config] of Object.entries(globalConfig.mcpServers)) {
        results.push({
          name,
          config,
          scope: "user",
          enabled: true,
          configFilePath: this.claudeGlobalPath,
        });
      }
    }

    // Disabled servers (from _disabled_mcpServers at top level)
    if (globalConfig._disabled_mcpServers) {
      for (const [name, config] of Object.entries(globalConfig._disabled_mcpServers)) {
        results.push({
          name,
          config,
          scope: "user",
          enabled: false,
          configFilePath: this.claudeGlobalPath,
        });
      }
    }

    return results;
  }

  /** Read `~/.claude.json` → `projects[workspacePath].mcpServers` (local/per-project scope) */
  private async readLocalServers(): Promise<McpServerEntry[]> {
    const root = this.workspaceRoot;
    if (!root) {
      return [];
    }

    const globalConfig = await this.readJson<ClaudeGlobalConfig>(this.claudeGlobalPath);
    const projectBlock = globalConfig?.projects?.[root];
    if (!projectBlock) {
      return [];
    }

    const results: McpServerEntry[] = [];

    if (projectBlock.mcpServers) {
      for (const [name, config] of Object.entries(projectBlock.mcpServers)) {
        results.push({
          name,
          config,
          scope: "local",
          enabled: true,
          configFilePath: this.claudeGlobalPath,
        });
      }
    }

    if (projectBlock._disabled_mcpServers) {
      for (const [name, config] of Object.entries(projectBlock._disabled_mcpServers)) {
        results.push({
          name,
          config,
          scope: "local",
          enabled: false,
          configFilePath: this.claudeGlobalPath,
        });
      }
    }

    return results;
  }

  /** Read enterprise managed MCP config */
  private async readManagedServers(): Promise<McpServerEntry[]> {
    const config = await this.readJson<ManagedMcpConfig>(this.managedConfigPath);
    if (!config?.mcpServers) {
      return [];
    }

    return Object.entries(config.mcpServers).map(([name, serverConfig]) => ({
      name,
      config: serverConfig,
      scope: "managed" as McpScope,
      enabled: true,
      configFilePath: this.managedConfigPath,
    }));
  }

  /** Read MCP servers provided by installed Claude Code plugins */
  private async readPluginServers(): Promise<McpServerEntry[]> {
    const registry = await this.readJson<InstalledPluginsFile>(this.installedPluginsPath);
    if (!registry?.plugins) {
      return [];
    }

    const settings = await this.readJson<ClaudeSettings>(this.claudeSettingsPath);
    const enabledMap = settings?.enabledPlugins ?? {};
    const workspaceRoot = this.workspaceRoot;

    const results: McpServerEntry[] = [];
    const seen = new Set<string>();

    for (const [pluginId, rawInstallations] of Object.entries(registry.plugins)) {
      try {
        // Normalize v1 (single object) vs v2 (array) format
        const installations: PluginInstallation[] = Array.isArray(rawInstallations)
          ? rawInstallations
          : [rawInstallations];

        for (const installation of installations) {
          // Resolve ~ in install paths
          const installPath = installation.installPath.startsWith("~")
            ? path.join(os.homedir(), installation.installPath.slice(1))
            : installation.installPath;

          // Filter: only project plugins matching current workspace
          // Use ancestor check: show if workspace is at or under the plugin's projectPath
          if (installation.scope === "project") {
            if (!workspaceRoot || !installation.projectPath) {
              continue;
            }
            const normalizedProject = installation.projectPath.endsWith("/")
              ? installation.projectPath
              : installation.projectPath + "/";
            if (workspaceRoot !== installation.projectPath && !workspaceRoot.startsWith(normalizedProject)) {
              continue;
            }
          }

          // Filter: only MCP-bearing plugins
          // Plugin .mcp.json may use either { mcpServers: { ... } } or flat { name: config } format
          const mcpConfigPath = this.pluginMcpConfigPath(installPath);
          const rawMcpConfig = await this.readJson<Record<string, unknown>>(mcpConfigPath);
          if (!rawMcpConfig) {
            continue;
          }

          // Resolve servers: check for mcpServers wrapper, otherwise treat top-level keys as servers
          const servers: Record<string, McpServerConfig> =
            (rawMcpConfig.mcpServers as Record<string, McpServerConfig> | undefined) ??
            (rawMcpConfig as unknown as Record<string, McpServerConfig>);

          if (!servers || Object.keys(servers).length === 0) {
            continue;
          }

          // Determine scope and enabled state
          // "global" plugins → "user"; "project" plugins → "local" unless their
          // projectPath is a proper ancestor of the workspace (e.g. home dir),
          // which means they apply broadly and should show as global.
          let scope: McpScope;
          if (installation.scope === "global") {
            scope = "user";
          } else if (installation.projectPath && workspaceRoot && installation.projectPath !== workspaceRoot) {
            scope = "user";
          } else {
            scope = "local";
          }
          const enabled = enabledMap[pluginId] !== false;

          // Deduplicate: skip if we've already seen this plugin at this scope
          const dedupeKey = `${pluginId}:${scope}`;
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          for (const [serverName, serverConfig] of Object.entries(servers)) {
            results.push({
              name: serverName,
              config: serverConfig,
              scope,
              enabled,
              configFilePath: mcpConfigPath,
              pluginId,
            });
          }
        }
      } catch {
        // Skip malformed plugin entries silently
        continue;
      }
    }

    return results;
  }

  // --- Toggle logic ---

  /** Toggle a server's enabled/disabled state */
  async toggleServer(entry: McpServerEntry): Promise<void> {
    if (entry.scope === "managed") {
      vscode.window.showWarningMessage("Managed MCP servers cannot be toggled.");
      return;
    }

    if (entry.pluginId) {
      await this.togglePlugin(entry);
    } else if (entry.scope === "project") {
      await this.toggleProjectServer(entry);
    } else {
      // user or local — use key-move strategy in ~/.claude.json
      await this.toggleClaudeJsonServer(entry);
    }
  }

  /**
   * Strategy B: Toggle `.mcp.json` server by managing `disabledMcpjsonServers`
   * in `.claude/settings.local.json`.
   */
  private async toggleProjectServer(entry: McpServerEntry): Promise<void> {
    const settingsPath = this.settingsLocalPath;
    if (!settingsPath) {
      return;
    }

    const settings = (await this.readJson<SettingsLocal>(settingsPath)) ?? {};
    const disabled = settings.disabledMcpjsonServers ?? [];

    if (entry.enabled) {
      // Disable: add to list
      if (!disabled.includes(entry.name)) {
        disabled.push(entry.name);
      }
    } else {
      // Enable: remove from list
      const idx = disabled.indexOf(entry.name);
      if (idx !== -1) {
        disabled.splice(idx, 1);
      }
    }

    settings.disabledMcpjsonServers = disabled;
    await this.writeJson(settingsPath, settings);
  }

  /**
   * Strategy C: Toggle a plugin by setting its boolean in
   * `enabledPlugins` map in `~/.claude/settings.json`.
   */
  private async togglePlugin(entry: McpServerEntry): Promise<void> {
    const settings = (await this.readJson<ClaudeSettings>(this.claudeSettingsPath)) ?? {};
    if (!settings.enabledPlugins) {
      settings.enabledPlugins = {};
    }
    // Flip: if currently enabled (true or absent), set false; if disabled, set true
    settings.enabledPlugins[entry.pluginId!] = !entry.enabled;
    await this.writeJson(this.claudeSettingsPath, settings);
  }

  /**
   * Strategy A: Toggle `~/.claude.json` server by moving entry between
   * `mcpServers` and `_disabled_mcpServers` keys.
   */
  private async toggleClaudeJsonServer(entry: McpServerEntry): Promise<void> {
    const globalConfig =
      (await this.readJson<ClaudeGlobalConfig>(this.claudeGlobalPath)) ?? {};

    if (entry.scope === "user") {
      this.moveServerKey(globalConfig, entry);
    } else if (entry.scope === "local") {
      const root = this.workspaceRoot;
      if (!root) {
        return;
      }
      if (!globalConfig.projects) {
        globalConfig.projects = {};
      }
      if (!globalConfig.projects[root]) {
        globalConfig.projects[root] = {};
      }
      this.moveServerKey(globalConfig.projects[root], entry);
    }

    await this.writeJson(this.claudeGlobalPath, globalConfig);
  }

  /** Move a server entry between `mcpServers` and `_disabled_mcpServers` within a config block */
  private moveServerKey(
    block: { mcpServers?: Record<string, McpServerConfig>; _disabled_mcpServers?: Record<string, McpServerConfig> },
    entry: McpServerEntry
  ): void {
    if (entry.enabled) {
      // Currently enabled → disable: move from mcpServers to _disabled_mcpServers
      if (block.mcpServers?.[entry.name]) {
        if (!block._disabled_mcpServers) {
          block._disabled_mcpServers = {};
        }
        block._disabled_mcpServers[entry.name] = block.mcpServers[entry.name];
        delete block.mcpServers[entry.name];
      }
    } else {
      // Currently disabled → enable: move from _disabled_mcpServers to mcpServers
      if (block._disabled_mcpServers?.[entry.name]) {
        if (!block.mcpServers) {
          block.mcpServers = {};
        }
        block.mcpServers[entry.name] = block._disabled_mcpServers[entry.name];
        delete block._disabled_mcpServers[entry.name];

        // Clean up empty _disabled_mcpServers object
        if (Object.keys(block._disabled_mcpServers).length === 0) {
          delete block._disabled_mcpServers;
        }
      }
    }
  }

  /** Open the config file for a given server entry in the editor */
  async openConfigFile(entry: McpServerEntry): Promise<void> {
    const uri = vscode.Uri.file(entry.configFilePath);
    await vscode.window.showTextDocument(uri);
  }
}
