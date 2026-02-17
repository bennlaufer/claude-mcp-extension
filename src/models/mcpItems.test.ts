import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServerEntry, HealthStatus, HealthCheckResult } from "../types";

// --- Mock vscode module (using vi.hoisted for factory access) ---
const { MockThemeIcon, MockThemeColor, MockMarkdownString, MockTreeItem } = vi.hoisted(() => {
  const MockThemeIcon = vi.fn().mockImplementation(function (this: any, id: string, color?: any) {
    this.id = id;
    this.color = color;
  });
  const MockThemeColor = vi.fn().mockImplementation(function (this: any, id: string) {
    this.id = id;
  });
  const MockMarkdownString = vi.fn().mockImplementation(function (this: any, value?: string) {
    this.value = value ?? "";
    this.isTrusted = false;
    this.supportThemeIcons = false;
    this.appendMarkdown = vi.fn().mockImplementation(function (this: any, str: string) {
      this.value += str;
      return this;
    });
  });
  const MockTreeItem = vi.fn().mockImplementation(function (this: any, label: string, state?: number) {
    this.label = label;
    this.collapsibleState = state;
  });
  return { MockThemeIcon, MockThemeColor, MockMarkdownString, MockTreeItem };
});

vi.mock("vscode", () => ({
  TreeItem: MockTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
  ThemeIcon: MockThemeIcon,
  ThemeColor: MockThemeColor,
  MarkdownString: MockMarkdownString,
  Uri: { parse: vi.fn((s: string) => ({ scheme: "mcp-health", path: s })) },
}));

import { McpServerItem, McpGroupItem, SettingsGroupItem, SettingItem, ClaudeCodeSettingItem } from "./mcpItems";

// --- Test fixtures ---

function makeEntry(overrides?: Partial<McpServerEntry>): McpServerEntry {
  return {
    name: "test-server",
    config: { command: "node", args: ["server.js"] },
    scope: "user",
    enabled: true,
    configFilePath: "/path/to/.claude.json",
    ...overrides,
  };
}

function makeHealthResult(overrides?: Partial<HealthCheckResult>): HealthCheckResult {
  return {
    status: HealthStatus.BinaryFound,
    checkedAt: new Date(),
    tier: 1,
    ...overrides,
  };
}

// --- Tests ---

describe("McpGroupItem", () => {
  it("creates project group with correct label", () => {
    const group = new McpGroupItem("project", 3);
    expect(group.scope).toBe("project");
    expect(group.serverCount).toBe(3);
  });

  it("creates user group with correct label", () => {
    const group = new McpGroupItem("user", 1);
    expect(group.scope).toBe("user");
  });

  it("pluralizes server count correctly", () => {
    const single = new McpGroupItem("project", 1);
    expect(single.description).toBe("1 server");

    const multi = new McpGroupItem("project", 5);
    expect(multi.description).toBe("5 servers");
  });
});

describe("McpServerItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Constructor basics ───────────────────────────────

  describe("constructor basics", () => {
    it("sets entry property", () => {
      const entry = makeEntry();
      const item = new McpServerItem(entry);
      expect(item.entry).toBe(entry);
    });

    it("sets healthResult when provided", () => {
      const entry = makeEntry();
      const health = makeHealthResult();
      const item = new McpServerItem(entry, health);
      expect(item.healthResult).toBe(health);
    });

    it("healthResult is undefined when not provided", () => {
      const entry = makeEntry();
      const item = new McpServerItem(entry);
      expect(item.healthResult).toBeUndefined();
    });
  });

  // ─── Context value ────────────────────────────────────

  describe("contextValue", () => {
    it("sets mcpServer.enabled for enabled servers", () => {
      const item = new McpServerItem(makeEntry({ enabled: true }));
      expect(item.contextValue).toBe("mcpServer.enabled");
    });

    it("sets mcpServer.disabled for disabled servers", () => {
      const item = new McpServerItem(makeEntry({ enabled: false }));
      expect(item.contextValue).toBe("mcpServer.disabled");
    });

    it("sets mcpServer.readonly for managed servers", () => {
      const item = new McpServerItem(makeEntry({ scope: "managed" }));
      expect(item.contextValue).toBe("mcpServer.readonly");
    });
  });

  // ─── Icon selection ───────────────────────────────────

  describe("icon (getHealthIcon)", () => {
    it("shows lock icon for managed servers", () => {
      const item = new McpServerItem(makeEntry({ scope: "managed" }));
      expect((item.iconPath as any).id).toBe("lock");
    });

    it("shows gray circle-outline for disabled servers", () => {
      const item = new McpServerItem(makeEntry({ enabled: false }));
      expect((item.iconPath as any).id).toBe("circle-outline");
      expect((item.iconPath as any).color.id).toBe("disabledForeground");
    });

    it("shows green circle-filled when no health data", () => {
      const item = new McpServerItem(makeEntry({ enabled: true }));
      expect((item.iconPath as any).id).toBe("circle-filled");
      expect((item.iconPath as any).color.id).toBe("testing.iconPassed");
    });

    it("shows loading spinner for Checking status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Checking }),
      );
      expect((item.iconPath as any).id).toBe("loading~spin");
    });

    it("shows pass-filled for Healthy status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );
      expect((item.iconPath as any).id).toBe("pass-filled");
      expect((item.iconPath as any).color.id).toBe("testing.iconPassed");
    });

    it("shows green circle for BinaryFound", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.BinaryFound }),
      );
      expect((item.iconPath as any).id).toBe("circle-filled");
      expect((item.iconPath as any).color.id).toBe("testing.iconPassed");
    });

    it("shows green circle for Reachable", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "http://localhost:3000" } }),
        makeHealthResult({ status: HealthStatus.Reachable }),
      );
      expect((item.iconPath as any).id).toBe("circle-filled");
    });

    it("shows warning icon for CommandNotFound", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.CommandNotFound }),
      );
      expect((item.iconPath as any).id).toBe("warning");
      expect((item.iconPath as any).color.id).toBe("problemsWarningIcon.foreground");
    });

    it("shows warning icon for Unreachable", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "http://localhost:3000" } }),
        makeHealthResult({ status: HealthStatus.Unreachable }),
      );
      expect((item.iconPath as any).id).toBe("warning");
    });

    it("shows shield icon for AuthFailed", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.AuthFailed }),
      );
      expect((item.iconPath as any).id).toBe("shield");
      expect((item.iconPath as any).color.id).toBe("testing.iconFailed");
    });

    it("shows error icon for Error status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Error }),
      );
      expect((item.iconPath as any).id).toBe("error");
      expect((item.iconPath as any).color.id).toBe("testing.iconFailed");
    });

    it("shows error icon for Degraded status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Degraded }),
      );
      expect((item.iconPath as any).id).toBe("error");
    });

    it("shows default green for Unknown status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Unknown }),
      );
      expect((item.iconPath as any).id).toBe("circle-filled");
      expect((item.iconPath as any).color.id).toBe("testing.iconPassed");
    });

    it("ignores health data for disabled servers (always gray)", () => {
      const item = new McpServerItem(
        makeEntry({ enabled: false }),
        makeHealthResult({ status: HealthStatus.Healthy }),
      );
      expect((item.iconPath as any).id).toBe("circle-outline");
      expect((item.iconPath as any).color.id).toBe("disabledForeground");
    });
  });

  // ─── Description ──────────────────────────────────────

  describe("description (getDescription)", () => {
    it("shows transport info for stdio server", () => {
      const item = new McpServerItem(makeEntry({ config: { command: "node", args: ["srv.js"] } }));
      expect(item.description).toBe("stdio · node");
    });

    it("shows transport info for HTTP server", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "http://localhost:3000/mcp" } }),
      );
      expect(item.description).toBe("http · http://localhost:3000/mcp");
    });

    it("appends checking status", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Checking }),
      );
      expect(item.description).toContain("checking...");
    });

    it("appends healthy with latency", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Healthy, latencyMs: 342, tier: 2 }),
      );
      expect(item.description).toContain("healthy (342ms)");
    });

    it("appends healthy without latency", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );
      expect(item.description).toContain("healthy");
      expect(item.description).not.toContain("ms)");
    });

    it("appends cmd not found", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.CommandNotFound }),
      );
      expect(item.description).toContain("cmd not found");
    });

    it("appends unreachable", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "http://localhost:3000" } }),
        makeHealthResult({ status: HealthStatus.Unreachable }),
      );
      expect(item.description).toContain("unreachable");
    });

    it("appends auth failed", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.AuthFailed }),
      );
      expect(item.description).toContain("auth failed");
    });

    it("appends error", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.Error }),
      );
      expect(item.description).toContain("error");
    });

    it("does not append health status for disabled servers", () => {
      const item = new McpServerItem(
        makeEntry({ enabled: false }),
        makeHealthResult({ status: HealthStatus.Healthy, latencyMs: 100, tier: 2 }),
      );
      expect(item.description).toBe("stdio · node");
      expect(item.description).not.toContain("healthy");
    });

    it("does not append health for BinaryFound (no suffix)", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ status: HealthStatus.BinaryFound }),
      );
      expect(item.description).toBe("stdio · node");
    });

    it("does not append health for Reachable (no suffix)", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "http://localhost:3000" } }),
        makeHealthResult({ status: HealthStatus.Reachable }),
      );
      expect(item.description).toBe("http · http://localhost:3000");
    });
  });

  // ─── Tooltip ──────────────────────────────────────────

  describe("tooltip (buildTooltip)", () => {
    it("includes server name in bold", () => {
      const item = new McpServerItem(makeEntry({ name: "my-server" }));
      const md = item.tooltip as any;
      expect(md.value).toContain("**my-server**");
    });

    it("includes scope info", () => {
      const item = new McpServerItem(makeEntry({ scope: "project" }));
      const md = item.tooltip as any;
      expect(md.value).toContain("project");
    });

    it("includes plugin ID when present", () => {
      const item = new McpServerItem(makeEntry({ pluginId: "my-plugin@org" }));
      const md = item.tooltip as any;
      expect(md.value).toContain("my-plugin@org");
    });

    it("does not include plugin row when absent", () => {
      const item = new McpServerItem(makeEntry());
      const md = item.tooltip as any;
      expect(md.value).not.toContain("Plugin");
    });

    it("includes enabled status", () => {
      const item = new McpServerItem(makeEntry({ enabled: true }));
      const md = item.tooltip as any;
      expect(md.value).toContain("Enabled");
    });

    it("includes disabled status", () => {
      const item = new McpServerItem(makeEntry({ enabled: false }));
      const md = item.tooltip as any;
      expect(md.value).toContain("Disabled");
    });

    it("includes command for stdio servers", () => {
      const item = new McpServerItem(
        makeEntry({ config: { command: "npx", args: ["-y", "pkg"] } }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("`npx -y pkg`");
    });

    it("includes URL for HTTP servers", () => {
      const item = new McpServerItem(
        makeEntry({ config: { url: "https://api.example.com/mcp" } }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("https://api.example.com/mcp");
    });

    it("includes config file path", () => {
      const item = new McpServerItem(makeEntry({ configFilePath: "/home/.claude.json" }));
      const md = item.tooltip as any;
      expect(md.value).toContain("/home/.claude.json");
    });

    it("includes health info when health result present", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({
          status: HealthStatus.Healthy,
          latencyMs: 150,
          toolCount: 5,
          tier: 2,
        }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("Health: healthy");
      expect(md.value).toContain("Tier 2");
      expect(md.value).toContain("150ms");
      expect(md.value).toContain("5");
    });

    it("includes error in tooltip when present", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({
          status: HealthStatus.Error,
          error: "Connection refused",
          tier: 2,
        }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("Connection refused");
    });

    it("includes server info when present", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({
          status: HealthStatus.Healthy,
          serverInfo: { name: "my-mcp", version: "2.1.0" },
          tier: 2,
        }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("my-mcp");
      expect(md.value).toContain("v2.1.0");
    });

    it("includes time ago for recent check", () => {
      const item = new McpServerItem(
        makeEntry(),
        makeHealthResult({ checkedAt: new Date() }),
      );
      const md = item.tooltip as any;
      expect(md.value).toContain("just now");
    });

    it("does not include health section when no health result", () => {
      const item = new McpServerItem(makeEntry());
      const md = item.tooltip as any;
      expect(md.value).not.toContain("Health:");
      expect(md.value).not.toContain("Tier");
    });

    it("sets supportThemeIcons to true", () => {
      const item = new McpServerItem(makeEntry());
      const md = item.tooltip as any;
      expect(md.supportThemeIcons).toBe(true);
    });
  });

  // ─── Checkbox ─────────────────────────────────────────

  describe("checkbox", () => {
    it("shows checked for enabled servers", () => {
      const item = new McpServerItem(makeEntry({ enabled: true }));
      expect(item.checkboxState).toEqual({ state: 1 });
    });

    it("shows unchecked for disabled servers", () => {
      const item = new McpServerItem(makeEntry({ enabled: false }));
      expect(item.checkboxState).toEqual({ state: 0 });
    });

    it("no checkbox for managed servers", () => {
      const item = new McpServerItem(makeEntry({ scope: "managed" }));
      expect(item.checkboxState).toBeUndefined();
    });
  });

  // ─── Backward compatibility ───────────────────────────

  describe("backward compatibility", () => {
    it("works without healthResult (same as before)", () => {
      const entry = makeEntry({ name: "my-srv", config: { command: "node" } });
      const item = new McpServerItem(entry);

      expect(item.entry).toBe(entry);
      expect(item.healthResult).toBeUndefined();
      expect((item.iconPath as any).id).toBe("circle-filled");
      expect(item.description).toBe("stdio · node");
      expect(item.contextValue).toBe("mcpServer.enabled");
    });
  });
});

// --- SettingsGroupItem tests ---

describe("SettingsGroupItem", () => {
  it("sets label to 'Settings'", () => {
    const group = new SettingsGroupItem(2);
    expect(group.label).toBe("Settings");
  });

  it("sets collapsibleState to Collapsed", () => {
    const group = new SettingsGroupItem(2);
    expect(group.collapsibleState).toBe(1); // Collapsed
  });

  it("sets contextValue to 'settingsGroup'", () => {
    const group = new SettingsGroupItem(2);
    expect(group.contextValue).toBe("settingsGroup");
  });

  it("sets iconPath to ThemeIcon('gear')", () => {
    const group = new SettingsGroupItem(2);
    expect((group.iconPath as any).id).toBe("gear");
  });

  it("pluralizes description for multiple settings", () => {
    const group = new SettingsGroupItem(2);
    expect(group.description).toBe("2 settings");
  });

  it("singularizes description for one setting", () => {
    const group = new SettingsGroupItem(1);
    expect(group.description).toBe("1 setting");
  });
});

// --- SettingItem tests ---

describe("SettingItem", () => {
  it("sets label from parameter", () => {
    const item = new SettingItem("autoHealthCheck", "Auto Health Check", "all");
    expect(item.label).toBe("Auto Health Check");
  });

  it("sets collapsibleState to None", () => {
    const item = new SettingItem("autoHealthCheck", "Auto Health Check", "all");
    expect(item.collapsibleState).toBe(0); // None
  });

  it("sets contextValue to 'settingItem'", () => {
    const item = new SettingItem("autoHealthCheck", "Auto Health Check", "all");
    expect(item.contextValue).toBe("settingItem");
  });

  it("sets description to current value", () => {
    const item = new SettingItem("healthCheckTimeoutMs", "Health Check Timeout", "15000");
    expect(item.description).toBe("15000");
  });

  it("sets command with correct command name and arguments array", () => {
    const item = new SettingItem("autoHealthCheck", "Auto Health Check", "all");
    expect(item.command).toEqual({
      command: "mcpManager.editSetting",
      title: "Edit Setting",
      arguments: ["autoHealthCheck"],
    });
  });

  it("exposes settingKey as public property", () => {
    const item = new SettingItem("healthCheckTimeoutMs", "Health Check Timeout", "15000");
    expect(item.settingKey).toBe("healthCheckTimeoutMs");
  });

  it("sets iconPath to ThemeIcon('settings-gear')", () => {
    const item = new SettingItem("autoHealthCheck", "Auto Health Check", "all");
    expect((item.iconPath as any).id).toBe("settings-gear");
  });
});

// --- ClaudeCodeSettingItem tests ---

describe("ClaudeCodeSettingItem", () => {
  it("sets label from parameter", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect(item.label).toBe("Tool Search");
  });

  it("sets collapsibleState to None", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect(item.collapsibleState).toBe(0); // None
  });

  it("sets contextValue to 'claudeCodeSettingItem'", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect(item.contextValue).toBe("claudeCodeSettingItem");
  });

  it("sets description to current value", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "true");
    expect(item.description).toBe("true");
  });

  it("sets command with correct command name and arguments", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect(item.command).toEqual({
      command: "mcpManager.editClaudeCodeSetting",
      title: "Edit Claude Code Setting",
      arguments: ["toolSearchMode"],
    });
  });

  it("exposes settingKey as public property", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect(item.settingKey).toBe("toolSearchMode");
  });

  it("sets iconPath to ThemeIcon('symbol-variable')", () => {
    const item = new ClaudeCodeSettingItem("toolSearchMode", "Tool Search", "auto");
    expect((item.iconPath as any).id).toBe("symbol-variable");
  });
});
