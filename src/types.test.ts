import { describe, it, expect } from "vitest";
import {
  HealthStatus,
  HealthCheckResult,
  HEALTH_SORT_PRIORITY,
  HEALTH_SORT_PRIORITY_DEFAULT,
  isStdioConfig,
  isHttpConfig,
  StdioServerConfig,
  HttpServerConfig,
  McpServerConfig,
} from "./types";

describe("HealthStatus enum", () => {
  it("has all expected status values", () => {
    expect(HealthStatus.Unknown).toBe("unknown");
    expect(HealthStatus.Checking).toBe("checking");
    expect(HealthStatus.BinaryFound).toBe("binary_found");
    expect(HealthStatus.CommandNotFound).toBe("command_not_found");
    expect(HealthStatus.Reachable).toBe("reachable");
    expect(HealthStatus.Unreachable).toBe("unreachable");
    expect(HealthStatus.Healthy).toBe("healthy");
    expect(HealthStatus.Degraded).toBe("degraded");
    expect(HealthStatus.AuthFailed).toBe("auth_failed");
    expect(HealthStatus.Error).toBe("error");
  });

  it("has exactly 10 status values", () => {
    const values = Object.values(HealthStatus);
    expect(values).toHaveLength(10);
  });

  it("all values are unique strings", () => {
    const values = Object.values(HealthStatus);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("HealthCheckResult interface", () => {
  it("accepts a minimal Tier 1 result", () => {
    const result: HealthCheckResult = {
      status: HealthStatus.BinaryFound,
      checkedAt: new Date(),
      tier: 1,
    };
    expect(result.status).toBe(HealthStatus.BinaryFound);
    expect(result.tier).toBe(1);
    expect(result.latencyMs).toBeUndefined();
    expect(result.toolCount).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.serverInfo).toBeUndefined();
  });

  it("accepts a full Tier 2 result with all optional fields", () => {
    const now = new Date();
    const result: HealthCheckResult = {
      status: HealthStatus.Healthy,
      latencyMs: 342,
      toolCount: 5,
      serverInfo: { name: "test-server", version: "1.0.0" },
      checkedAt: now,
      tier: 2,
    };
    expect(result.status).toBe(HealthStatus.Healthy);
    expect(result.latencyMs).toBe(342);
    expect(result.toolCount).toBe(5);
    expect(result.serverInfo).toEqual({ name: "test-server", version: "1.0.0" });
    expect(result.checkedAt).toBe(now);
    expect(result.tier).toBe(2);
  });

  it("accepts error results", () => {
    const result: HealthCheckResult = {
      status: HealthStatus.Error,
      error: "Connection refused",
      latencyMs: 15000,
      checkedAt: new Date(),
      tier: 2,
    };
    expect(result.status).toBe(HealthStatus.Error);
    expect(result.error).toBe("Connection refused");
  });

  it("accepts auth failed results", () => {
    const result: HealthCheckResult = {
      status: HealthStatus.AuthFailed,
      error: "HTTP 401 Unauthorized",
      latencyMs: 200,
      checkedAt: new Date(),
      tier: 1,
    };
    expect(result.status).toBe(HealthStatus.AuthFailed);
    expect(result.tier).toBe(1);
  });
});

describe("isStdioConfig type guard", () => {
  it("returns true for stdio configs", () => {
    const config: StdioServerConfig = { command: "node", args: ["server.js"] };
    expect(isStdioConfig(config)).toBe(true);
  });

  it("returns false for HTTP configs", () => {
    const config: HttpServerConfig = { url: "http://localhost:3000" };
    expect(isStdioConfig(config)).toBe(false);
  });

  it("returns true for stdio with env and cwd", () => {
    const config: StdioServerConfig = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: { NODE_ENV: "production" },
      cwd: "/tmp",
    };
    expect(isStdioConfig(config)).toBe(true);
  });
});

describe("isHttpConfig type guard", () => {
  it("returns true for HTTP configs", () => {
    const config: HttpServerConfig = { url: "http://localhost:3000/mcp" };
    expect(isHttpConfig(config)).toBe(true);
  });

  it("returns true for HTTP configs with headers", () => {
    const config: HttpServerConfig = {
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer token123" },
    };
    expect(isHttpConfig(config)).toBe(true);
  });

  it("returns false for stdio configs", () => {
    const config: StdioServerConfig = { command: "node" };
    expect(isHttpConfig(config)).toBe(false);
  });
});

describe("HEALTH_SORT_PRIORITY", () => {
  it("maps every HealthStatus enum value", () => {
    const enumValues = Object.values(HealthStatus);
    const mappedKeys = Object.keys(HEALTH_SORT_PRIORITY);
    expect(mappedKeys.sort()).toEqual(enumValues.sort());
  });

  it("has default priority of 2 (unknown tier)", () => {
    expect(HEALTH_SORT_PRIORITY_DEFAULT).toBe(2);
  });
});

describe("type guard mutual exclusion", () => {
  it("stdio config is not HTTP", () => {
    const config: McpServerConfig = { command: "node", args: [] };
    expect(isStdioConfig(config)).toBe(true);
    expect(isHttpConfig(config)).toBe(false);
  });

  it("HTTP config is not stdio", () => {
    const config: McpServerConfig = { url: "http://localhost:3000" };
    expect(isStdioConfig(config)).toBe(false);
    expect(isHttpConfig(config)).toBe(true);
  });
});
