import * as vscode from "vscode";
import { McpServerEntry, McpScope } from "../types";
import { McpGroupItem, McpServerItem } from "../models/mcpItems";
import { ConfigService } from "../services/configService";

type TreeItem = McpGroupItem | McpServerItem;

/** Scope display order */
const SCOPE_ORDER: McpScope[] = ["project", "user", "local", "managed"];

export class McpTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private servers: McpServerEntry[] = [];

  constructor(private readonly configService: ConfigService) {}

  async refresh(): Promise<void> {
    this.servers = await this.configService.getAllServers();
    vscode.commands.executeCommand(
      "setContext",
      "mcpManager.hasServers",
      this.servers.length > 0
    );
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof McpGroupItem) {
      return this.getServerItems(element.scope);
    }

    return [];
  }

  private getRootItems(): McpGroupItem[] {
    const groups: McpGroupItem[] = [];

    for (const scope of SCOPE_ORDER) {
      const count = this.servers.filter((s) => s.scope === scope).length;
      if (count > 0) {
        groups.push(new McpGroupItem(scope, count));
      }
    }

    return groups;
  }

  private getServerItems(scope: McpScope): McpServerItem[] {
    return this.servers
      .filter((s) => s.scope === scope)
      .map((s) => new McpServerItem(s));
  }

  /** Find the McpServerEntry for a given McpServerItem */
  getEntryForItem(item: McpServerItem): McpServerEntry {
    return item.entry;
  }
}
