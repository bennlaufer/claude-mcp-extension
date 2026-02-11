import * as vscode from "vscode";
import { McpServerEntry, McpScope, isStdioConfig, isHttpConfig } from "../types";

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
  constructor(public readonly entry: McpServerEntry) {
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

    // Transport-aware description
    if (isStdioConfig(entry.config)) {
      this.description = `stdio · ${entry.config.command}`;
    } else if (isHttpConfig(entry.config)) {
      this.description = `http · ${entry.config.url}`;
    }

    // Icon: colored circle based on enabled state
    if (isReadOnly) {
      this.iconPath = new vscode.ThemeIcon("lock", new vscode.ThemeColor("disabledForeground"));
    } else if (entry.enabled) {
      this.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
    } else {
      this.iconPath = new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("disabledForeground"));
    }

    // Rich tooltip
    this.tooltip = this.buildTooltip();
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;

    md.appendMarkdown(`**${this.entry.name}**\n\n`);
    md.appendMarkdown(`- **Scope:** ${this.entry.scope}\n`);
    if (this.entry.pluginId) {
      md.appendMarkdown(`- **Plugin:** ${this.entry.pluginId}\n`);
    }
    md.appendMarkdown(`- **Status:** ${this.entry.enabled ? "Enabled" : "Disabled"}\n`);

    if (isStdioConfig(this.entry.config)) {
      const args = this.entry.config.args?.join(" ") ?? "";
      md.appendMarkdown(`- **Command:** \`${this.entry.config.command} ${args}\`\n`);
    } else if (isHttpConfig(this.entry.config)) {
      md.appendMarkdown(`- **URL:** ${this.entry.config.url}\n`);
    }

    md.appendMarkdown(`- **Config:** ${this.entry.configFilePath}\n`);

    return md;
  }
}
