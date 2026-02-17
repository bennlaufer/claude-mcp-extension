import * as vscode from "vscode";
import { McpServerEntry, McpScope, HealthStatus, HealthCheckResult, McpManagerSettings, ClaudeCodeSettings, isStdioConfig, isHttpConfig } from "../types";

/** Group header in the TreeView ("Project MCPs", "Global MCPs", etc.) */
export class McpGroupItem extends vscode.TreeItem {
  constructor(
    public readonly scope: McpScope,
    public readonly serverCount: number
  ) {
    super(McpGroupItem.labelFor(scope), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "mcpGroup";
    this.description = `${serverCount} server${serverCount !== 1 ? "s" : ""}`;
    this.iconPath = new vscode.ThemeIcon(McpGroupItem.iconFor(scope));
  }

  private static labelFor(scope: McpScope): string {
    switch (scope) {
      case "project":
        return "Project MCPs";
      case "user":
        return "Global MCPs";
      case "local":
        return "Local MCPs";
      case "managed":
        return "Managed MCPs";
    }
  }

  private static iconFor(scope: McpScope): string {
    switch (scope) {
      case "project":
        return "folder";
      case "user":
        return "home";
      case "local":
        return "file-submodule";
      case "managed":
        return "lock";
    }
  }
}

/** Individual MCP server entry with a checkbox */
export class McpServerItem extends vscode.TreeItem {
  constructor(
    public readonly entry: McpServerEntry,
    public readonly healthResult?: HealthCheckResult,
  ) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);

    const isReadOnly = entry.scope === "managed";

    // Context value drives context menu visibility
    if (isReadOnly) {
      this.contextValue = "mcpServer.readonly";
    } else {
      this.contextValue = entry.enabled ? "mcpServer.enabled" : "mcpServer.disabled";
    }

    // Checkbox — must use object form (bare 0 is falsy, VS Code bug)
    if (!isReadOnly) {
      this.checkboxState = {
        state: entry.enabled
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked,
      };
    }

    // Health-aware icon
    this.iconPath = this.getHealthIcon();

    // Health-aware description
    this.description = this.getDescription();

    // Rich tooltip with health info
    this.tooltip = this.buildTooltip();
  }

  private getHealthIcon(): vscode.ThemeIcon {
    const isReadOnly = this.entry.scope === "managed";

    if (isReadOnly) {
      return new vscode.ThemeIcon("lock", new vscode.ThemeColor("disabledForeground"));
    }

    if (!this.entry.enabled) {
      return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("disabledForeground"));
    }

    if (!this.healthResult) {
      return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
    }

    switch (this.healthResult.status) {
      case HealthStatus.Checking:
        return new vscode.ThemeIcon("loading~spin");
      case HealthStatus.Healthy:
        return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
      case HealthStatus.BinaryFound:
      case HealthStatus.Reachable:
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
      case HealthStatus.CommandNotFound:
      case HealthStatus.Unreachable:
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
      case HealthStatus.AuthFailed:
        return new vscode.ThemeIcon("shield", new vscode.ThemeColor("testing.iconFailed"));
      case HealthStatus.Error:
      case HealthStatus.Degraded:
        return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
      default:
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
    }
  }

  private getDescription(): string {
    let desc = "";
    if (isStdioConfig(this.entry.config)) {
      desc = `stdio · ${this.entry.config.command}`;
    } else if (isHttpConfig(this.entry.config)) {
      desc = `http · ${this.entry.config.url}`;
    }

    if (this.healthResult && this.entry.enabled) {
      switch (this.healthResult.status) {
        case HealthStatus.Checking:
          desc += " · checking...";
          break;
        case HealthStatus.Healthy:
          desc += this.healthResult.latencyMs
            ? ` · healthy (${this.healthResult.latencyMs}ms)`
            : " · healthy";
          break;
        case HealthStatus.CommandNotFound:
          desc += " · cmd not found";
          break;
        case HealthStatus.Unreachable:
          desc += " · unreachable";
          break;
        case HealthStatus.AuthFailed:
          desc += " · auth failed";
          break;
        case HealthStatus.Error:
          desc += " · error";
          break;
      }
    }

    return desc;
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown(`**${this.entry.name}**\n\n`);

    // Basic info table
    md.appendMarkdown(`| | |\n|---|---|\n`);
    md.appendMarkdown(`| **Scope** | ${this.entry.scope} |\n`);
    if (this.entry.pluginId) {
      md.appendMarkdown(`| **Plugin** | ${this.entry.pluginId} |\n`);
    }
    md.appendMarkdown(`| **Status** | ${this.entry.enabled ? "Enabled" : "Disabled"} |\n`);

    if (isStdioConfig(this.entry.config)) {
      const args = this.entry.config.args?.join(" ") ?? "";
      md.appendMarkdown(`| **Command** | \`${this.entry.config.command} ${args}\` |\n`);
    } else if (isHttpConfig(this.entry.config)) {
      md.appendMarkdown(`| **URL** | ${this.entry.config.url} |\n`);
    }

    // Health info
    if (this.healthResult) {
      md.appendMarkdown(`\n---\n\n`);
      const statusIcon = this.getStatusIcon(this.healthResult.status);
      md.appendMarkdown(`$(${statusIcon}) **Health: ${this.healthResult.status}**`);
      md.appendMarkdown(` (Tier ${this.healthResult.tier} check)\n\n`);

      if (this.healthResult.latencyMs !== undefined) {
        md.appendMarkdown(`| **Latency** | ${this.healthResult.latencyMs}ms |\n`);
      }
      if (this.healthResult.toolCount !== undefined) {
        md.appendMarkdown(`| **Tools** | ${this.healthResult.toolCount} |\n`);
      }
      if (this.healthResult.serverInfo) {
        md.appendMarkdown(`| **Server** | ${this.healthResult.serverInfo.name} v${this.healthResult.serverInfo.version} |\n`);
      }
      if (this.healthResult.error) {
        md.appendMarkdown(`\n$(error) **Error:** ${this.healthResult.error}\n`);
      }

      const ago = this.timeAgo(this.healthResult.checkedAt);
      md.appendMarkdown(`\n*Checked ${ago}*\n`);
    }

    md.appendMarkdown(`\n---\n*Config:* ${this.entry.configFilePath}`);

    return md;
  }

  private getStatusIcon(status: HealthStatus): string {
    switch (status) {
      case HealthStatus.Healthy: return "pass-filled";
      case HealthStatus.BinaryFound:
      case HealthStatus.Reachable: return "circle-filled";
      case HealthStatus.CommandNotFound:
      case HealthStatus.Unreachable: return "warning";
      case HealthStatus.AuthFailed: return "shield";
      case HealthStatus.Error:
      case HealthStatus.Degraded: return "error";
      case HealthStatus.Checking: return "sync~spin";
      default: return "question";
    }
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
}

/** Settings group header in the TreeView */
export class SettingsGroupItem extends vscode.TreeItem {
  constructor(public readonly settingCount: number) {
    super("Settings", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "settingsGroup";
    this.description = `${settingCount} setting${settingCount !== 1 ? "s" : ""}`;
    this.iconPath = new vscode.ThemeIcon("gear");
  }
}

/** Individual setting entry, click to edit */
export class SettingItem extends vscode.TreeItem {
  constructor(
    public readonly settingKey: keyof McpManagerSettings,
    label: string,
    currentValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "settingItem";
    this.description = currentValue;
    this.iconPath = new vscode.ThemeIcon("settings-gear");
    this.command = {
      command: "mcpManager.editSetting",
      title: "Edit Setting",
      arguments: [settingKey],
    };
  }
}

/** Individual Claude Code setting entry, click to edit */
export class ClaudeCodeSettingItem extends vscode.TreeItem {
  constructor(
    public readonly settingKey: keyof ClaudeCodeSettings,
    label: string,
    currentValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "claudeCodeSettingItem";
    this.description = currentValue;
    this.iconPath = new vscode.ThemeIcon("symbol-variable");
    this.command = {
      command: "mcpManager.editClaudeCodeSetting",
      title: "Edit Claude Code Setting",
      arguments: [settingKey],
    };
  }
}
