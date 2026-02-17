import * as vscode from "vscode";
import { ConfigService } from "./services/configService";
import { SettingsService } from "./services/settingsService";
import { HealthCheckService } from "./services/healthCheckService";
import { McpTreeDataProvider } from "./providers/mcpTreeDataProvider";
import { McpServerItem } from "./models/mcpItems";
import { HealthStatus, McpManagerSettings, SETTING_DEFINITIONS } from "./types";

export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService();
  const settingsService = new SettingsService();
  const healthService = new HealthCheckService(settingsService);
  const treeDataProvider = new McpTreeDataProvider(configService, healthService, settingsService);

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

    vscode.commands.registerCommand("mcpManager.checkHealth", async (item: McpServerItem) => {
      if (!item?.entry) return;

      const result = await vscode.window.withProgress(
        { location: { viewId: "mcpServersView" }, title: "Checking..." },
        () => treeDataProvider.deepCheckServer(item.entry),
      );

      if (result.status === HealthStatus.Healthy) {
        const parts = [`${item.entry.name}: Healthy`];
        if (result.latencyMs !== undefined) parts.push(`${result.latencyMs}ms`);
        if (result.toolCount !== undefined) parts.push(`${result.toolCount} tools`);
        vscode.window.showInformationMessage(parts.join(" · "));
      } else {
        const msg = result.error
          ? `${item.entry.name}: ${result.status} — ${result.error}`
          : `${item.entry.name}: ${result.status}`;
        vscode.window.showWarningMessage(msg);
      }
    }),

    vscode.commands.registerCommand("mcpManager.checkAllHealth", async () => {
      const results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "MCP Health Check" },
        () => treeDataProvider.deepCheckAll(),
      );

      let healthy = 0;
      let unhealthy = 0;
      for (const result of results.values()) {
        if (result.status === HealthStatus.Healthy) {
          healthy++;
        } else {
          unhealthy++;
        }
      }

      if (unhealthy === 0) {
        vscode.window.showInformationMessage(`All ${healthy} MCP servers healthy`);
      } else {
        vscode.window.showWarningMessage(`${healthy} healthy, ${unhealthy} unhealthy`);
      }
    }),

    vscode.commands.registerCommand("mcpManager.editSetting", async (settingKey: keyof McpManagerSettings) => {
      const def = SETTING_DEFINITIONS.find(d => d.key === settingKey);
      if (!def) return;

      if (def.type === "enum" && def.options) {
        const currentValue = await settingsService.get(settingKey);
        const pick = await vscode.window.showQuickPick(
          def.options.map(o => ({
            ...o,
            picked: o.label === String(currentValue),
          })),
          { placeHolder: def.description }
        );
        if (pick) {
          await settingsService.set(settingKey, pick.label as any);
          await treeDataProvider.refresh();
        }
      } else if (def.type === "number") {
        const currentValue = await settingsService.get(settingKey);
        const input = await vscode.window.showInputBox({
          prompt: `${def.label} (${def.min}-${def.max})`,
          value: String(currentValue),
          validateInput: (val) => {
            const n = parseInt(val, 10);
            if (isNaN(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
              return `Must be between ${def.min} and ${def.max}`;
            }
            return undefined;
          },
        });
        if (input !== undefined) {
          await settingsService.set(settingKey, parseInt(input, 10) as any);
          await treeDataProvider.refresh();
        }
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
