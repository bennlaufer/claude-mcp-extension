import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerEntry, HealthStatus } from "../types";

// --- Mock SettingsService ---
const { mockSettingsGet } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn().mockResolvedValue(15_000),
}));

vi.mock("./settingsService", () => ({
  SettingsService: class MockSettingsService {
    get = mockSettingsGet;
    getAll = vi.fn().mockResolvedValue({
      autoHealthCheck: "all",
      healthCheckTimeoutMs: 15000,
    });
    set = vi.fn();
  },
}));

// --- Mock `which` ---
vi.mock("which", () => ({
  default: {
    sync: vi.fn(),
  },
}));

// --- Mock MCP SDK ---
const mockConnect = vi.fn();
const mockPing = vi.fn();
const mockListTools = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = mockConnect;
    ping = mockPing;
    listTools = mockListTools;
    close = mockClose;
    constructor() {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

import whichModule from "which";
import { HealthCheckService } from "./healthCheckService";
import { SettingsService } from "./settingsService";

// --- Test fixtures ---

function makeStdioEntry(overrides?: Partial<McpServerEntry>): McpServerEntry {
  return {
    name: "test-stdio",
    config: { command: "node", args: ["server.js"] },
    scope: "user",
    enabled: true,
    configFilePath: "/path/to/.claude.json",
    ...overrides,
  };
}

function makeHttpEntry(overrides?: Partial<McpServerEntry>): McpServerEntry {
  return {
    name: "test-http",
    config: { url: "http://localhost:3000/mcp" },
    scope: "project",
    enabled: true,
    configFilePath: "/path/to/.mcp.json",
    ...overrides,
  };
}

function makeDisabledEntry(): McpServerEntry {
  return {
    name: "disabled-server",
    config: { command: "node" },
    scope: "user",
    enabled: false,
    configFilePath: "/path/to/.claude.json",
  };
}

// --- Tests ---

describe("HealthCheckService", () => {
  let service: HealthCheckService;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGet.mockResolvedValue(15_000);
    settingsService = new SettingsService();
    service = new HealthCheckService(settingsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── cacheKey ─────────────────────────────────────────

  describe("cacheKey", () => {
    it("generates key from name and scope", () => {
      const entry = makeStdioEntry({ name: "my-server", scope: "user" });
      expect(service.cacheKey(entry)).toBe("my-server:user");
    });

    it("generates different keys for same name in different scopes", () => {
      const user = makeStdioEntry({ name: "srv", scope: "user" });
      const project = makeStdioEntry({ name: "srv", scope: "project" });
      expect(service.cacheKey(user)).not.toBe(service.cacheKey(project));
    });

    it("generates different keys for different names in same scope", () => {
      const a = makeStdioEntry({ name: "server-a", scope: "user" });
      const b = makeStdioEntry({ name: "server-b", scope: "user" });
      expect(service.cacheKey(a)).not.toBe(service.cacheKey(b));
    });
  });

  // ─── Cache ────────────────────────────────────────────

  describe("getCachedResult", () => {
    it("returns undefined for uncached entry", () => {
      const entry = makeStdioEntry();
      expect(service.getCachedResult(entry)).toBeUndefined();
    });

    it("returns cached result after Tier 1 check", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      await service.checkTier1(entry);

      const cached = service.getCachedResult(entry);
      expect(cached).toBeDefined();
      expect(cached!.status).toBe(HealthStatus.BinaryFound);
    });

    it("returns undefined for expired cache entries", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      await service.checkTier1(entry);

      // Request with -1ms max age — always expired
      const cached = service.getCachedResult(entry, -1);
      expect(cached).toBeUndefined();
    });

    it("returns result within max age", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      await service.checkTier1(entry);

      // 1 hour max age
      const cached = service.getCachedResult(entry, 3600000);
      expect(cached).toBeDefined();
    });
  });

  describe("clearCache", () => {
    it("removes all cached results", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry1 = makeStdioEntry({ name: "srv1" });
      const entry2 = makeStdioEntry({ name: "srv2" });

      await service.checkTier1(entry1);
      await service.checkTier1(entry2);

      expect(service.getCachedResult(entry1)).toBeDefined();
      expect(service.getCachedResult(entry2)).toBeDefined();

      service.clearCache();

      expect(service.getCachedResult(entry1)).toBeUndefined();
      expect(service.getCachedResult(entry2)).toBeUndefined();
    });
  });

  // ─── Tier 1: Stdio ───────────────────────────────────

  describe("checkTier1 (stdio)", () => {
    it("returns BinaryFound when command exists on PATH", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.BinaryFound);
      expect(result.tier).toBe(1);
      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it("returns CommandNotFound when command is missing", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue(null);

      const entry = makeStdioEntry({ config: { command: "nonexistent-bin" } });
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.CommandNotFound);
      expect(result.tier).toBe(1);
      expect(result.error).toContain("nonexistent-bin");
      expect(result.error).toContain("not found on PATH");
    });

    it("calls which.sync with nothrow: true", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/npx");

      const entry = makeStdioEntry({ config: { command: "npx", args: ["-y", "some-package"] } });
      await service.checkTier1(entry);

      expect(whichSync).toHaveBeenCalledWith("npx", { nothrow: true });
    });

    it("returns Error if which throws unexpectedly", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockImplementation(() => {
        throw new Error("Unexpected which error");
      });

      const entry = makeStdioEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Error);
      expect(result.tier).toBe(1);
      expect(result.error).toBe("Failed to check command existence");
    });

    it("returns Unknown for disabled stdio servers", async () => {
      const entry = makeDisabledEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unknown);
      expect(result.tier).toBe(1);
    });

    it("caches the result after check", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      await service.checkTier1(entry);

      const cached = service.getCachedResult(entry);
      expect(cached).toBeDefined();
      expect(cached!.status).toBe(HealthStatus.BinaryFound);
    });
  });

  // ─── Tier 1: HTTP ─────────────────────────────────────

  describe("checkTier1 (HTTP)", () => {
    it("returns Reachable when server responds with 200", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Reachable);
      expect(result.tier).toBe(1);
      expect(result.latencyMs).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it("returns Reachable for 404 response (server is up, just wrong path)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 404,
        statusText: "Not Found",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Reachable);
    });

    it("returns Reachable for 405 Method Not Allowed", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 405,
        statusText: "Method Not Allowed",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Reachable);
    });

    it("returns Reachable for 500 Internal Server Error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 500,
        statusText: "Internal Server Error",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Reachable);
    });

    it("returns AuthFailed for 401 Unauthorized", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 401,
        statusText: "Unauthorized",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.AuthFailed);
      expect(result.error).toContain("401");
      expect(result.error).toContain("Unauthorized");
    });

    it("returns AuthFailed for 403 Forbidden", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 403,
        statusText: "Forbidden",
      });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.AuthFailed);
      expect(result.error).toContain("403");
    });

    it("returns Unreachable when fetch throws (network error)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
      expect(result.error).toBe("fetch failed");
    });

    it("returns Unreachable on DNS resolution failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND example.invalid"),
      );
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry({
        config: { url: "http://example.invalid/mcp" },
      });
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
      expect(result.error).toContain("ENOTFOUND");
    });

    it("returns Unreachable on timeout", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("The operation was aborted"));
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
      expect(result.error).toContain("aborted");
    });

    it("sends HEAD request with configured headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry({
        config: {
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer token123" },
        },
      });
      await service.checkTier1(entry);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/mcp",
        expect.objectContaining({
          method: "HEAD",
          headers: { Authorization: "Bearer token123" },
        }),
      );
    });

    it("returns Unknown for disabled HTTP servers", async () => {
      const entry = makeHttpEntry({ enabled: false });
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unknown);
    });

    it("caches HTTP results", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      await service.checkTier1(entry);

      const cached = service.getCachedResult(entry);
      expect(cached).toBeDefined();
      expect(cached!.status).toBe(HealthStatus.Reachable);
    });
  });

  // ─── Tier 2: Full MCP check ──────────────────────────

  describe("checkTier2 (stdio)", () => {
    it("returns Healthy when connect + ping succeed", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [{ name: "tool1" }, { name: "tool2" }] });
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.tier).toBe(2);
      expect(result.toolCount).toBe(2);
      expect(result.latencyMs).toBeDefined();
    });

    it("returns Healthy even if listTools fails", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockRejectedValue(new Error("Method not found"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.toolCount).toBeUndefined();
    });

    it("returns CommandNotFound for ENOENT errors", async () => {
      mockConnect.mockRejectedValue(new Error("spawn node ENOENT"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.CommandNotFound);
      expect(result.error).toContain("ENOENT");
    });

    it("returns Error on connection timeout", async () => {
      vi.useFakeTimers();

      // Simulate a connect that never resolves
      mockConnect.mockImplementation(() => new Promise(() => {}));
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const resultPromise = service.checkTier2(entry);

      // Advance past the 15s connect timeout
      await vi.advanceTimersByTimeAsync(16_000);

      const result = await resultPromise;
      expect(result.status).toBe(HealthStatus.Error);
      expect(result.error).toContain("timed out");

      vi.useRealTimers();
    });

    it("uses configurable timeout from SettingsService", async () => {
      vi.useFakeTimers();

      // Set custom timeout via mock setting
      mockSettingsGet.mockResolvedValue(5_000);

      mockConnect.mockImplementation(() => new Promise(() => {}));
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const resultPromise = service.checkTier2(entry);

      // Advance past the custom 5s timeout but under default 15s
      await vi.advanceTimersByTimeAsync(6_000);

      const result = await resultPromise;
      expect(result.status).toBe(HealthStatus.Error);
      expect(result.error).toContain("timed out");

      vi.useRealTimers();
    });

    it("returns Unknown for disabled servers", async () => {
      const entry = makeDisabledEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Unknown);
      expect(result.tier).toBe(2);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("always calls close() even on error", async () => {
      mockConnect.mockRejectedValue(new Error("connect failed"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      await service.checkTier2(entry);

      expect(mockClose).toHaveBeenCalled();
    });

    it("handles close() failure gracefully", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });
      mockClose.mockRejectedValue(new Error("close failed"));

      const entry = makeStdioEntry();
      const result = await service.checkTier2(entry);

      // Should still return healthy, not crash
      expect(result.status).toBe(HealthStatus.Healthy);
    });

    it("caches Tier 2 results", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      await service.checkTier2(entry);

      const cached = service.getCachedResult(entry);
      expect(cached).toBeDefined();
      expect(cached!.status).toBe(HealthStatus.Healthy);
      expect(cached!.tier).toBe(2);
    });
  });

  describe("checkTier2 (HTTP)", () => {
    it("returns Healthy when connect + ping succeed", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [{ name: "t1" }] });
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.tier).toBe(2);
      expect(result.toolCount).toBe(1);
    });

    it("returns Unreachable for ECONNREFUSED errors", async () => {
      mockConnect.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3000"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("returns Unreachable for fetch failed errors", async () => {
      mockConnect.mockRejectedValue(new Error("fetch failed"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
    });

    it("returns AuthFailed for 401 errors", async () => {
      mockConnect.mockRejectedValue(new Error("HTTP 401 Unauthorized"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.AuthFailed);
    });

    it("returns AuthFailed for 403 errors", async () => {
      mockConnect.mockRejectedValue(new Error("HTTP 403 Forbidden"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.AuthFailed);
    });

    it("returns Error for generic failures", async () => {
      mockConnect.mockRejectedValue(new Error("Something unexpected happened"));
      mockClose.mockResolvedValue(undefined);

      const entry = makeHttpEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Error);
      expect(result.error).toBe("Something unexpected happened");
    });
  });

  // ─── Tier 2 error classification ─────────────────────

  describe("Tier 2 error classification", () => {
    beforeEach(() => {
      mockClose.mockResolvedValue(undefined);
    });

    const errorCases: Array<{ error: string; expectedStatus: HealthStatus }> = [
      { error: "spawn node ENOENT", expectedStatus: HealthStatus.CommandNotFound },
      { error: "connect ECONNREFUSED 127.0.0.1:3000", expectedStatus: HealthStatus.Unreachable },
      { error: "fetch failed", expectedStatus: HealthStatus.Unreachable },
      { error: "HTTP 401 Unauthorized", expectedStatus: HealthStatus.AuthFailed },
      { error: "HTTP 403 Forbidden", expectedStatus: HealthStatus.AuthFailed },
      { error: "Unauthorized access", expectedStatus: HealthStatus.AuthFailed },
      { error: "Connection timed out", expectedStatus: HealthStatus.Error },
      { error: "Unknown error", expectedStatus: HealthStatus.Error },
      { error: "Protocol error", expectedStatus: HealthStatus.Error },
    ];

    for (const { error, expectedStatus } of errorCases) {
      it(`classifies "${error}" as ${expectedStatus}`, async () => {
        mockConnect.mockRejectedValue(new Error(error));

        const entry = makeStdioEntry();
        const result = await service.checkTier2(entry);

        expect(result.status).toBe(expectedStatus);
        expect(result.error).toBe(error);
      });
    }
  });

  // ─── Cache interaction between tiers ──────────────────

  describe("cache interaction between tiers", () => {
    it("Tier 2 result overwrites Tier 1 result in cache", async () => {
      // Tier 1 check
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      await service.checkTier1(entry);

      let cached = service.getCachedResult(entry);
      expect(cached!.status).toBe(HealthStatus.BinaryFound);
      expect(cached!.tier).toBe(1);

      // Tier 2 check overwrites
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });
      mockClose.mockResolvedValue(undefined);

      await service.checkTier2(entry);

      cached = service.getCachedResult(entry);
      expect(cached!.status).toBe(HealthStatus.Healthy);
      expect(cached!.tier).toBe(2);
    });

    it("Tier 1 re-check overwrites stale Tier 2 result", async () => {
      // Start with Tier 2 result
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      await service.checkTier2(entry);

      let cached = service.getCachedResult(entry);
      expect(cached!.tier).toBe(2);

      // Tier 1 overwrites
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      await service.checkTier1(entry);

      cached = service.getCachedResult(entry);
      expect(cached!.tier).toBe(1);
    });
  });

  // ─── Edge cases ───────────────────────────────────────

  describe("edge cases", () => {
    it("handles non-Error thrown objects in Tier 2", async () => {
      mockConnect.mockRejectedValue("string error");
      mockClose.mockResolvedValue(undefined);

      const entry = makeStdioEntry();
      const result = await service.checkTier2(entry);

      expect(result.status).toBe(HealthStatus.Error);
      expect(result.error).toBe("string error");
    });

    it("handles non-Error thrown objects in Tier 1 HTTP", async () => {
      const mockFetch = vi.fn().mockRejectedValue("network down");
      vi.stubGlobal("fetch", mockFetch);

      const entry = makeHttpEntry();
      const result = await service.checkTier1(entry);

      expect(result.status).toBe(HealthStatus.Unreachable);
      expect(result.error).toBe("network down");
    });

    it("result always has checkedAt as a Date", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();
      const result = await service.checkTier1(entry);

      expect(result.checkedAt).toBeInstanceOf(Date);
      expect(result.checkedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("handles servers with empty config gracefully", async () => {
      const entry: McpServerEntry = {
        name: "weird",
        config: {} as any,
        scope: "user",
        enabled: true,
        configFilePath: "/path",
      };

      const result1 = await service.checkTier1(entry);
      expect(result1.status).toBe(HealthStatus.Unknown);

      const result2 = await service.checkTier2(entry);
      expect(result2.status).toBe(HealthStatus.Unknown);
    });

    it("multiple concurrent checks on same entry use separate results", async () => {
      const whichSync = whichModule.sync as ReturnType<typeof vi.fn>;
      whichSync.mockReturnValue("/usr/bin/node");

      const entry = makeStdioEntry();

      // Run two checks in parallel
      const [r1, r2] = await Promise.all([
        service.checkTier1(entry),
        service.checkTier1(entry),
      ]);

      expect(r1.status).toBe(HealthStatus.BinaryFound);
      expect(r2.status).toBe(HealthStatus.BinaryFound);
    });
  });
});
