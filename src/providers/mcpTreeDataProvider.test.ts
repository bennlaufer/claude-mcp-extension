import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServerEntry, HealthStatus, HealthCheckResult } from "../types";

// --- Hoisted mock references ---
const {
  mockFireEvent,
  mockExecuteCommand,
  mockCheckTier1,
  mockCheckTier2,
  mockCacheKey,
  mockGetAllServers,
  mockSettingsGetAll,
  mockClaudeCodeSettingsGetAll,
} = vi.hoisted(() => ({
  mockFireEvent: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockCheckTier1: vi.fn(),
  mockCheckTier2: vi.fn(),
  mockCacheKey: vi.fn().mockImplementation((entry: any) => `${entry.name}:${entry.scope}`),
  mockGetAllServers: vi.fn(),
  mockSettingsGetAll: vi.fn().mockResolvedValue({
    autoHealthCheck: "all",
    healthCheckTimeoutMs: 15000,
  }),
  mockClaudeCodeSettingsGetAll: vi.fn().mockResolvedValue({
    toolSearchMode: "auto",
  }),
}));

// --- Mock vscode ---
vi.mock("vscode", () => {
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

  return {
    EventEmitter: class MockEventEmitter {
      event = vi.fn();
      fire = mockFireEvent;
      dispose = vi.fn();
    },
    TreeItem: vi.fn().mockImplementation(function (this: any, label: string, state?: number) {
      this.label = label;
      this.collapsibleState = state;
    }),
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    ThemeIcon: MockThemeIcon,
    ThemeColor: MockThemeColor,
    MarkdownString: MockMarkdownString,
    Uri: { parse: vi.fn((s: string) => ({ scheme: "mcp-health", path: s })) },
    commands: { executeCommand: mockExecuteCommand },
  };
});

// --- Mock HealthCheckService ---
vi.mock("../services/healthCheckService", () => ({
  HealthCheckService: class MockHealthCheckService {
    checkTier1 = mockCheckTier1;
    checkTier2 = mockCheckTier2;
    cacheKey = mockCacheKey;
    getCachedResult = vi.fn();
    clearCache = vi.fn();
  },
}));

// --- Mock ConfigService ---
vi.mock("../services/configService", () => ({
  ConfigService: class MockConfigService {
    getAllServers = mockGetAllServers;
  },
}));

// --- Mock SettingsService ---
vi.mock("../services/settingsService", () => ({
  SettingsService: class MockSettingsService {
    getAll = mockSettingsGetAll;
    get = vi.fn().mockImplementation(async (key: string) => {
      const all = await mockSettingsGetAll();
      return (all as any)[key];
    });
    set = vi.fn();
  },
}));

// --- Mock ClaudeCodeSettingsService ---
vi.mock("../services/claudeCodeSettingsService", () => ({
  ClaudeCodeSettingsService: class MockClaudeCodeSettingsService {
    getAll = mockClaudeCodeSettingsGetAll;
    get = vi.fn().mockImplementation(async (key: string) => {
      const all = await mockClaudeCodeSettingsGetAll();
      return (all as any)[key];
    });
    set = vi.fn();
  },
}));

import { McpTreeDataProvider } from "./mcpTreeDataProvider";
import { McpGroupItem, McpServerItem, SettingsGroupItem, SettingItem, ClaudeCodeSettingItem } from "../models/mcpItems";
import { ConfigService } from "../services/configService";
import { HealthCheckService } from "../services/healthCheckService";
import { SettingsService } from "../services/settingsService";
import { ClaudeCodeSettingsService } from "../services/claudeCodeSettingsService";

// --- Fixtures ---

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

describe("McpTreeDataProvider", () => {
  let provider: McpTreeDataProvider;
  let configService: ConfigService;
  let healthService: HealthCheckService;
  let settingsService: SettingsService;
  let claudeCodeSettingsService: ClaudeCodeSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGetAll.mockResolvedValue({
      autoHealthCheck: "all",
      healthCheckTimeoutMs: 15000,
    });
    mockClaudeCodeSettingsGetAll.mockResolvedValue({
      toolSearchMode: "auto",
    });
    configService = new ConfigService();
    healthService = new HealthCheckService();
    settingsService = new SettingsService();
    claudeCodeSettingsService = new ClaudeCodeSettingsService();
    provider = new McpTreeDataProvider(configService, healthService, settingsService, claudeCodeSettingsService);
  });

  // ─── refresh ──────────────────────────────────────────

  describe("refresh", () => {
    it("loads servers from config service", async () => {
      const servers = [makeEntry({ name: "srv1" }), makeEntry({ name: "srv2" })];
      mockGetAllServers.mockResolvedValue(servers);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      expect(mockGetAllServers).toHaveBeenCalled();
    });

    it("sets hasServers context when servers exist", async () => {
      mockGetAllServers.mockResolvedValue([makeEntry()]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "mcpManager.hasServers", true);
    });

    it("clears hasServers context when no servers", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "mcpManager.hasServers", false);
    });

    it("fires tree change event on refresh", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      expect(mockFireEvent).toHaveBeenCalled();
    });

    it("triggers Tier 1 checks for enabled servers", async () => {
      const enabled = makeEntry({ name: "enabled-srv", enabled: true });
      const disabled = makeEntry({ name: "disabled-srv", enabled: false });
      mockGetAllServers.mockResolvedValue([enabled, disabled]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckTier1).toHaveBeenCalledWith(enabled);
      expect(mockCheckTier1).not.toHaveBeenCalledWith(disabled);
    });

    it("fires tree change again after Tier 1 checks complete", async () => {
      mockGetAllServers.mockResolvedValue([makeEntry()]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // At least 2 fires: one from refresh, one from runTier1Checks
      expect(mockFireEvent).toHaveBeenCalledTimes(2);
    });

    it("skips all auto-checks when autoHealthCheck is 'none'", async () => {
      mockSettingsGetAll.mockResolvedValue({
        autoHealthCheck: "none",
        healthCheckTimeoutMs: 15000,
      });

      mockGetAllServers.mockResolvedValue([makeEntry({ enabled: true })]);

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckTier1).not.toHaveBeenCalled();
    });

    it("only auto-checks HTTP servers when autoHealthCheck is 'httpOnly'", async () => {
      mockSettingsGetAll.mockResolvedValue({
        autoHealthCheck: "httpOnly",
        healthCheckTimeoutMs: 15000,
      });

      const stdio = makeEntry({ name: "stdio-srv", config: { command: "node" }, enabled: true });
      const http = makeEntry({ name: "http-srv", config: { url: "http://localhost:3000" }, enabled: true });
      mockGetAllServers.mockResolvedValue([stdio, http]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckTier1).toHaveBeenCalledWith(http);
      expect(mockCheckTier1).not.toHaveBeenCalledWith(stdio);
    });

    it("auto-checks all servers when autoHealthCheck is 'all'", async () => {
      const stdio = makeEntry({ name: "stdio-srv", config: { command: "node" }, enabled: true });
      const http = makeEntry({ name: "http-srv", config: { url: "http://localhost:3000" }, enabled: true });
      mockGetAllServers.mockResolvedValue([stdio, http]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckTier1).toHaveBeenCalledWith(stdio);
      expect(mockCheckTier1).toHaveBeenCalledWith(http);
    });
  });

  // ─── getChildren ──────────────────────────────────────

  describe("getChildren", () => {
    it("returns group items at root level (plus settings)", async () => {
      mockGetAllServers.mockResolvedValue([
        makeEntry({ scope: "project" }),
        makeEntry({ scope: "user" }),
      ]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      expect(roots).toHaveLength(3); // 2 scope groups + 1 settings group
      expect(roots[0]).toBeInstanceOf(McpGroupItem);
      expect(roots[1]).toBeInstanceOf(McpGroupItem);
      expect(roots[2]).toBeInstanceOf(SettingsGroupItem);
    });

    it("returns server items for a group", async () => {
      mockGetAllServers.mockResolvedValue([
        makeEntry({ name: "srv1", scope: "user" }),
        makeEntry({ name: "srv2", scope: "user" }),
        makeEntry({ name: "srv3", scope: "project" }),
      ]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      const userGroup = roots.find((r) => (r as McpGroupItem).scope === "user");
      const children = provider.getChildren(userGroup);
      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(McpServerItem);
    });

    it("returns empty array for server items (leaf nodes)", async () => {
      mockGetAllServers.mockResolvedValue([makeEntry()]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]);
      const leaf = provider.getChildren(children[0]);
      expect(leaf).toEqual([]);
    });

    it("groups servers by scope in correct order", async () => {
      mockGetAllServers.mockResolvedValue([
        makeEntry({ scope: "managed", name: "m1" }),
        makeEntry({ scope: "project", name: "p1" }),
        makeEntry({ scope: "local", name: "l1" }),
        makeEntry({ scope: "user", name: "u1" }),
      ]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      // Last item is SettingsGroupItem; first 4 are scope groups
      const scopeGroups = roots.slice(0, -1) as McpGroupItem[];
      const scopes = scopeGroups.map((r) => r.scope);
      expect(scopes).toEqual(["project", "user", "local", "managed"]);
    });

    it("omits groups with zero servers", async () => {
      mockGetAllServers.mockResolvedValue([
        makeEntry({ scope: "user", name: "u1" }),
      ]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      // 1 scope group + 1 settings group
      expect(roots).toHaveLength(2);
      expect((roots[0] as McpGroupItem).scope).toBe("user");
      expect(roots[1]).toBeInstanceOf(SettingsGroupItem);
    });
  });

  // ─── Server item sorting ────────────────────────────

  describe("server item sorting", () => {
    it("sorts healthy servers before error servers", async () => {
      const errorSrv = makeEntry({ name: "alpha-srv", scope: "user" });
      const healthySrv = makeEntry({ name: "beta-srv", scope: "user" });
      mockGetAllServers.mockResolvedValue([errorSrv, healthySrv]);
      mockCheckTier1.mockImplementation((entry: any) => {
        if (entry.name === "alpha-srv") return Promise.resolve(makeHealthResult({ status: HealthStatus.Error }));
        return Promise.resolve(makeHealthResult({ status: HealthStatus.Healthy }));
      });

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children[0].entry.name).toBe("beta-srv");
      expect(children[1].entry.name).toBe("alpha-srv");
    });

    it("sorts alphabetically within same health priority", async () => {
      const srvC = makeEntry({ name: "charlie", scope: "user" });
      const srvA = makeEntry({ name: "alpha", scope: "user" });
      const srvB = makeEntry({ name: "bravo", scope: "user" });
      mockGetAllServers.mockResolvedValue([srvC, srvA, srvB]);
      mockCheckTier1.mockResolvedValue(makeHealthResult({ status: HealthStatus.BinaryFound }));

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children.map((c) => c.entry.name)).toEqual(["alpha", "bravo", "charlie"]);
    });

    it("sorts by full priority: healthy > unknown > error", async () => {
      const errorSrv = makeEntry({ name: "error-srv", scope: "user" });
      const unknownSrv = makeEntry({ name: "unknown-srv", scope: "user" });
      const healthySrv = makeEntry({ name: "healthy-srv", scope: "user" });
      mockGetAllServers.mockResolvedValue([errorSrv, unknownSrv, healthySrv]);
      mockCheckTier1.mockImplementation((entry: any) => {
        if (entry.name === "error-srv") return Promise.resolve(makeHealthResult({ status: HealthStatus.Error }));
        if (entry.name === "unknown-srv") return Promise.resolve(makeHealthResult({ status: HealthStatus.Unknown }));
        return Promise.resolve(makeHealthResult({ status: HealthStatus.Healthy }));
      });

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children.map((c) => c.entry.name)).toEqual(["healthy-srv", "unknown-srv", "error-srv"]);
    });

    it("servers with no health result sort as unknown priority", async () => {
      const noHealthSrv = makeEntry({ name: "no-health", scope: "user" });
      const healthySrv = makeEntry({ name: "healthy-srv", scope: "user" });
      const errorSrv = makeEntry({ name: "error-srv", scope: "user" });
      mockGetAllServers.mockResolvedValue([noHealthSrv, healthySrv, errorSrv]);

      // Only return results for healthy and error servers, not for no-health
      mockCheckTier1.mockImplementation((entry: any) => {
        if (entry.name === "healthy-srv") return Promise.resolve(makeHealthResult({ status: HealthStatus.Healthy }));
        if (entry.name === "error-srv") return Promise.resolve(makeHealthResult({ status: HealthStatus.Error }));
        // no-health will never resolve a Tier 1 result into the map
        return Promise.resolve(makeHealthResult({ status: HealthStatus.Unknown }));
      });

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      // healthy (0) < no-health/unknown (2) < error (3)
      expect(children[0].entry.name).toBe("healthy-srv");
      expect(children[1].entry.name).toBe("no-health");
      expect(children[2].entry.name).toBe("error-srv");
    });

    it("sorting works independently per scope group", async () => {
      const userError = makeEntry({ name: "alpha", scope: "user" });
      const userHealthy = makeEntry({ name: "beta", scope: "user" });
      const projectError = makeEntry({ name: "gamma", scope: "project" });
      const projectHealthy = makeEntry({ name: "delta", scope: "project" });
      mockGetAllServers.mockResolvedValue([userError, userHealthy, projectError, projectHealthy]);
      mockCheckTier1.mockImplementation((entry: any) => {
        if (entry.name === "alpha" || entry.name === "gamma") {
          return Promise.resolve(makeHealthResult({ status: HealthStatus.Error }));
        }
        return Promise.resolve(makeHealthResult({ status: HealthStatus.Healthy }));
      });

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const projectGroup = roots.find((r) => (r as McpGroupItem).scope === "project")!;
      const userGroup = roots.find((r) => (r as McpGroupItem).scope === "user")!;

      const projectChildren = provider.getChildren(projectGroup) as McpServerItem[];
      expect(projectChildren.map((c) => c.entry.name)).toEqual(["delta", "gamma"]);

      const userChildren = provider.getChildren(userGroup) as McpServerItem[];
      expect(userChildren.map((c) => c.entry.name)).toEqual(["beta", "alpha"]);
    });
  });

  // ─── Health data in server items ──────────────────────

  describe("health data in server items", () => {
    it("passes health result to McpServerItem after Tier 1 check", async () => {
      const entry = makeEntry({ name: "srv1", scope: "user" });
      const healthResult = makeHealthResult({ status: HealthStatus.BinaryFound });

      mockGetAllServers.mockResolvedValue([entry]);
      mockCheckTier1.mockResolvedValue(healthResult);

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children[0].healthResult).toBeDefined();
      expect(children[0].healthResult!.status).toBe(HealthStatus.BinaryFound);
    });

    it("server items have no health data before Tier 1 completes", async () => {
      let resolveTier1: any;
      mockCheckTier1.mockImplementation(
        () => new Promise((resolve) => { resolveTier1 = resolve; }),
      );
      mockGetAllServers.mockResolvedValue([makeEntry()]);

      await provider.refresh();

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children[0].healthResult).toBeUndefined();

      resolveTier1?.(makeHealthResult());
    });
  });

  // ─── deepCheckServer ──────────────────────────────────

  describe("deepCheckServer", () => {
    it("sets Checking status before running Tier 2", async () => {
      const entry = makeEntry({ name: "srv1" });
      mockGetAllServers.mockResolvedValue([entry]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockFireEvent.mockClear();

      const tier2Result = makeHealthResult({
        status: HealthStatus.Healthy,
        tier: 2,
        latencyMs: 200,
      });
      mockCheckTier2.mockResolvedValue(tier2Result);

      const result = await provider.deepCheckServer(entry);

      expect(mockFireEvent).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(HealthStatus.Healthy);
    });

    it("returns the Tier 2 result", async () => {
      const entry = makeEntry();
      mockGetAllServers.mockResolvedValue([entry]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const tier2Result = makeHealthResult({
        status: HealthStatus.Healthy,
        tier: 2,
        toolCount: 3,
      });
      mockCheckTier2.mockResolvedValue(tier2Result);

      const result = await provider.deepCheckServer(entry);
      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.toolCount).toBe(3);
    });

    it("updates tree items with Tier 2 result", async () => {
      const entry = makeEntry({ name: "srv1", scope: "user" });
      mockGetAllServers.mockResolvedValue([entry]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockCheckTier2.mockResolvedValue(
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );

      await provider.deepCheckServer(entry);

      const roots = provider.getChildren();
      const children = provider.getChildren(roots[0]) as McpServerItem[];
      expect(children[0].healthResult!.status).toBe(HealthStatus.Healthy);
      expect(children[0].healthResult!.tier).toBe(2);
    });
  });

  // ─── deepCheckAll ─────────────────────────────────────

  describe("deepCheckAll", () => {
    it("checks all enabled servers", async () => {
      const srv1 = makeEntry({ name: "srv1", enabled: true });
      const srv2 = makeEntry({ name: "srv2", enabled: true });
      const disabled = makeEntry({ name: "disabled", enabled: false });
      mockGetAllServers.mockResolvedValue([srv1, srv2, disabled]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockCheckTier2.mockResolvedValue(
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );

      const results = await provider.deepCheckAll();

      expect(mockCheckTier2).toHaveBeenCalledTimes(2);
      expect(mockCheckTier2).toHaveBeenCalledWith(srv1);
      expect(mockCheckTier2).toHaveBeenCalledWith(srv2);
      expect(results.size).toBe(2);
    });

    it("returns map of results keyed by cache key", async () => {
      const srv1 = makeEntry({ name: "srv1", scope: "user" });
      const srv2 = makeEntry({ name: "srv2", scope: "project" });
      mockGetAllServers.mockResolvedValue([srv1, srv2]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockCheckTier2.mockResolvedValue(
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );

      const results = await provider.deepCheckAll();

      expect(results.has("srv1:user")).toBe(true);
      expect(results.has("srv2:project")).toBe(true);
    });

    it("fires progressive tree updates", async () => {
      const srv1 = makeEntry({ name: "srv1" });
      const srv2 = makeEntry({ name: "srv2" });
      mockGetAllServers.mockResolvedValue([srv1, srv2]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockFireEvent.mockClear();

      mockCheckTier2.mockResolvedValue(
        makeHealthResult({ status: HealthStatus.Healthy, tier: 2 }),
      );

      await provider.deepCheckAll();

      // 1 for initial Checking state + 2 progressive updates (one per server)
      expect(mockFireEvent).toHaveBeenCalledTimes(3);
    });

    it("returns empty map when no enabled servers", async () => {
      mockGetAllServers.mockResolvedValue([
        makeEntry({ enabled: false }),
      ]);

      await provider.refresh();

      const results = await provider.deepCheckAll();
      expect(results.size).toBe(0);
      expect(mockCheckTier2).not.toHaveBeenCalled();
    });
  });

  // ─── getTreeItem ──────────────────────────────────────

  describe("getTreeItem", () => {
    it("returns the element as-is", async () => {
      mockGetAllServers.mockResolvedValue([makeEntry()]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      expect(provider.getTreeItem(roots[0])).toBe(roots[0]);
    });
  });

  // ─── Settings group ──────────────────────────────────

  describe("settings group", () => {
    it("root children include SettingsGroupItem as last item", async () => {
      mockGetAllServers.mockResolvedValue([makeEntry({ scope: "user" })]);
      mockCheckTier1.mockResolvedValue(makeHealthResult());

      await provider.refresh();

      const roots = provider.getChildren();
      const last = roots[roots.length - 1];
      expect(last).toBeInstanceOf(SettingsGroupItem);
    });

    it("settings group is present even with no servers", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBeInstanceOf(SettingsGroupItem);
    });

    it("SettingsGroupItem children return SettingItem and ClaudeCodeSettingItem", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      const roots = provider.getChildren();
      const settingsGroup = roots.find((r) => r instanceof SettingsGroupItem)!;
      const children = provider.getChildren(settingsGroup);

      expect(children).toHaveLength(3);
      expect(children[0]).toBeInstanceOf(ClaudeCodeSettingItem);
      expect(children[1]).toBeInstanceOf(SettingItem);
      expect(children[2]).toBeInstanceOf(SettingItem);
    });

    it("SettingItem descriptions reflect cached settings values", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      const roots = provider.getChildren();
      const settingsGroup = roots.find((r) => r instanceof SettingsGroupItem)!;
      const children = provider.getChildren(settingsGroup) as SettingItem[];

      const autoCheck = children.find((c) => c.settingKey === "autoHealthCheck")!;
      expect(autoCheck.description).toBe("all");

      const timeout = children.find((c) => c.settingKey === "healthCheckTimeoutMs")!;
      expect(timeout.description).toBe("15000");
    });

    it("after refresh with changed settings, SettingItem descriptions update", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      // Change settings
      mockSettingsGetAll.mockResolvedValue({
        autoHealthCheck: "none",
        healthCheckTimeoutMs: 5000,
      });

      await provider.refresh();

      const roots = provider.getChildren();
      const settingsGroup = roots.find((r) => r instanceof SettingsGroupItem)!;
      const children = provider.getChildren(settingsGroup) as SettingItem[];

      const autoCheck = children.find((c) => c.settingKey === "autoHealthCheck")!;
      expect(autoCheck.description).toBe("none");

      const timeout = children.find((c) => c.settingKey === "healthCheckTimeoutMs")!;
      expect(timeout.description).toBe("5000");
    });

    it("ClaudeCodeSettingItem appears with correct description", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      const roots = provider.getChildren();
      const settingsGroup = roots.find((r) => r instanceof SettingsGroupItem)!;
      const children = provider.getChildren(settingsGroup);
      const ccItem = children.find((c) => c instanceof ClaudeCodeSettingItem) as ClaudeCodeSettingItem;

      expect(ccItem).toBeDefined();
      expect(ccItem.settingKey).toBe("toolSearchMode");
      expect(ccItem.description).toBe("auto");
    });

    it("after refresh with changed Claude Code settings, description updates", async () => {
      mockGetAllServers.mockResolvedValue([]);

      await provider.refresh();

      // Change Claude Code settings
      mockClaudeCodeSettingsGetAll.mockResolvedValue({
        toolSearchMode: "true",
      });

      await provider.refresh();

      const roots = provider.getChildren();
      const settingsGroup = roots.find((r) => r instanceof SettingsGroupItem)!;
      const children = provider.getChildren(settingsGroup);
      const ccItem = children.find((c) => c instanceof ClaudeCodeSettingItem) as ClaudeCodeSettingItem;

      expect(ccItem.description).toBe("true");
    });

    it("runTier1Checks uses cached autoHealthCheck setting", async () => {
      mockSettingsGetAll.mockResolvedValue({
        autoHealthCheck: "none",
        healthCheckTimeoutMs: 15000,
      });

      mockGetAllServers.mockResolvedValue([makeEntry({ enabled: true })]);

      await provider.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckTier1).not.toHaveBeenCalled();
    });
  });
});
