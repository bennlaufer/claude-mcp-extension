import * as vscode from "vscode";
import { McpServerEntry, McpScope, HealthStatus, HealthCheckResult, McpManagerSettings, SETTINGS_DEFAULTS, SETTING_DEFINITIONS, ClaudeCodeSettings, CLAUDE_CODE_SETTINGS_DEFAULTS, CLAUDE_CODE_SETTING_DEFINITIONS, isHttpConfig, HEALTH_SORT_PRIORITY, HEALTH_SORT_PRIORITY_DEFAULT } from "../types";
import { McpGroupItem, McpServerItem, SettingsGroupItem, SettingItem, ClaudeCodeSettingItem } from "../models/mcpItems";
import { ConfigService } from "../services/configService";
import { HealthCheckService } from "../services/healthCheckService";
import { SettingsService } from "../services/settingsService";
import { ClaudeCodeSettingsService } from "../services/claudeCodeSettingsService";

type TreeItem = McpGroupItem | McpServerItem | SettingsGroupItem | SettingItem | ClaudeCodeSettingItem;

/** Scope display order */
const SCOPE_ORDER: McpScope[] = ["project", "user", "local", "managed"];

export class McpTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private servers: McpServerEntry[] = [];
  private healthResults = new Map<string, HealthCheckResult>();
  private cachedSettings: McpManagerSettings = { ...SETTINGS_DEFAULTS };
  private cachedClaudeCodeSettings: ClaudeCodeSettings = { ...CLAUDE_CODE_SETTINGS_DEFAULTS };

  constructor(
    private readonly configService: ConfigService,
    private readonly healthService: HealthCheckService,
    private readonly settingsService: SettingsService,
    private readonly claudeCodeSettingsService: ClaudeCodeSettingsService,
  ) {}

  async refresh(): Promise<void> {
    const [servers, settings, claudeCodeSettings] = await Promise.all([
      this.configService.getAllServers(),
      this.settingsService.getAll(),
      this.claudeCodeSettingsService.getAll(),
    ]);
    this.servers = servers;
    this.cachedSettings = settings;
    this.cachedClaudeCodeSettings = claudeCodeSettings;
    vscode.commands.executeCommand(
      "setContext",
      "mcpManager.hasServers",
      this.servers.length > 0,
    );
    this._onDidChangeTreeData.fire();

    // Run Tier 1 checks on all enabled servers (non-blocking)
    this.runTier1Checks();
  }

  /** Run Tier 1 lightweight checks on enabled servers, filtered by autoHealthCheck setting */
  private async runTier1Checks(): Promise<void> {
    const autoSetting = this.cachedSettings.autoHealthCheck;

    if (autoSetting === "none") return;

    let candidates = this.servers.filter((s) => s.enabled);
    if (autoSetting === "httpOnly") {
      candidates = candidates.filter((s) => isHttpConfig(s.config));
    }

    if (candidates.length === 0) return;

    const results = await Promise.all(
      candidates.map((s) => this.healthService.checkTier1(s).then((r) => [s, r] as const)),
    );

    for (const [server, result] of results) {
      this.healthResults.set(this.healthService.cacheKey(server), result);
    }

    this._onDidChangeTreeData.fire();
  }

  /** Run Tier 2 deep check on a single server */
  async deepCheckServer(entry: McpServerEntry): Promise<HealthCheckResult> {
    const key = this.healthService.cacheKey(entry);

    // Set "checking" state and refresh
    this.healthResults.set(key, {
      status: HealthStatus.Checking,
      checkedAt: new Date(),
      tier: 2,
    });
    this._onDidChangeTreeData.fire();

    // Run full check
    const result = await this.healthService.checkTier2(entry);
    this.healthResults.set(key, result);
    this._onDidChangeTreeData.fire();
    return result;
  }

  /** Run Tier 2 deep check on all enabled servers */
  async deepCheckAll(): Promise<Map<string, HealthCheckResult>> {
    const enabled = this.servers.filter((s) => s.enabled);

    // Set all to "checking"
    for (const server of enabled) {
      this.healthResults.set(this.healthService.cacheKey(server), {
        status: HealthStatus.Checking,
        checkedAt: new Date(),
        tier: 2,
      });
    }
    this._onDidChangeTreeData.fire();

    // Run checks in parallel with progressive updates
    const results = new Map<string, HealthCheckResult>();
    await Promise.all(
      enabled.map(async (server) => {
        const result = await this.healthService.checkTier2(server);
        const key = this.healthService.cacheKey(server);
        this.healthResults.set(key, result);
        results.set(key, result);
        this._onDidChangeTreeData.fire();
      }),
    );

    return results;
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof SettingsGroupItem) {
      const items: (SettingItem | ClaudeCodeSettingItem)[] = CLAUDE_CODE_SETTING_DEFINITIONS.map(
        (def) => new ClaudeCodeSettingItem(def.key, def.label, String(this.cachedClaudeCodeSettings[def.key])),
      );
      for (const def of SETTING_DEFINITIONS) {
        items.push(new SettingItem(def.key, def.label, String(this.cachedSettings[def.key])));
      }
      return items;
    }

    if (element instanceof McpGroupItem) {
      return this.getServerItems(element.scope);
    }

    return [];
  }

  private getRootItems(): TreeItem[] {
    const items: TreeItem[] = [];

    for (const scope of SCOPE_ORDER) {
      const count = this.servers.filter((s) => s.scope === scope).length;
      if (count > 0) {
        items.push(new McpGroupItem(scope, count));
      }
    }

    items.push(new SettingsGroupItem(SETTING_DEFINITIONS.length + CLAUDE_CODE_SETTING_DEFINITIONS.length));
    return items;
  }

  private getServerItems(scope: McpScope): McpServerItem[] {
    return this.servers
      .filter((s) => s.scope === scope)
      .map((s) => new McpServerItem(
        s,
        this.healthResults.get(this.healthService.cacheKey(s)),
      ))
      .sort((a, b) => {
        const pa = a.healthResult
          ? HEALTH_SORT_PRIORITY[a.healthResult.status]
          : HEALTH_SORT_PRIORITY_DEFAULT;
        const pb = b.healthResult
          ? HEALTH_SORT_PRIORITY[b.healthResult.status]
          : HEALTH_SORT_PRIORITY_DEFAULT;
        if (pa !== pb) return pa - pb;
        return a.entry.name.localeCompare(b.entry.name);
      });
  }

  /** Find the McpServerEntry for a given McpServerItem */
  getEntryForItem(item: McpServerItem): McpServerEntry {
    return item.entry;
  }
}
