import * as vscode from "vscode";
import { ConfigService } from "./services/configService";
import { McpTreeDataProvider } from "./providers/mcpTreeDataProvider";
import { McpServerItem } from "./models/mcpItems";

export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService();
  const treeDataProvider = new McpTreeDataProvider(configService);

  // Create TreeView with manual checkbox management
  const treeView = vscode.window.createTreeView("mcpServersView", {
    treeDataProvider,
    manageCheckboxStateManually: true,
  });

  // Handle checkbox state changes
  treeView.onDidChangeCheckboxState(async (e) => {
    for (const [item] of e.items) {
      if (item instanceof McpServerItem) {
        await configService.toggleServer(item.entry);
      }
    }
    await treeDataProvider.refresh();
    showRestartNotification();
  });

  // Register commands
  context.subscriptions.push(
    treeView,

    vscode.commands.registerCommand("mcpManager.refresh", () => {
      treeDataProvider.refresh();
    }),

    vscode.commands.registerCommand("mcpManager.enableServer", async (item: McpServerItem) => {
      if (item?.entry && !item.entry.enabled) {
        await configService.toggleServer(item.entry);
        await treeDataProvider.refresh();
        showRestartNotification();
      }
    }),

    vscode.commands.registerCommand("mcpManager.disableServer", async (item: McpServerItem) => {
      if (item?.entry && item.entry.enabled) {
        await configService.toggleServer(item.entry);
        await treeDataProvider.refresh();
        showRestartNotification();
      }
    }),

    vscode.commands.registerCommand("mcpManager.editConfig", async (item: McpServerItem) => {
      if (item?.entry) {
        await configService.openConfigFile(item.entry);
      }
    }),
  );

  // Initial load
  treeDataProvider.refresh();
}

function showRestartNotification() {
  vscode.window.showInformationMessage(
    "MCP configuration updated. Restart Claude Code for changes to take effect.",
    "OK"
  );
}

export function deactivate() {}
