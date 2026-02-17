import {
  McpServerEntry,
  HealthStatus,
  HealthCheckResult,
  isStdioConfig,
  isHttpConfig,
  StdioServerConfig,
  HttpServerConfig,
} from "../types";
import { SettingsService } from "./settingsService";
import which from "which";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TIER1_HTTP_TIMEOUT_MS = 5_000;
const TIER2_PING_TIMEOUT_MS = 5_000;

export class HealthCheckService {
  private cache = new Map<string, HealthCheckResult>();

  constructor(private readonly settingsService: SettingsService) {}

  /** Get cache key for a server entry */
  cacheKey(entry: McpServerEntry): string {
    return `${entry.name}:${entry.scope}`;
  }

  /** Get cached result, or undefined if expired/absent */
  getCachedResult(entry: McpServerEntry, maxAgeMs = 5 * 60 * 1000): HealthCheckResult | undefined {
    const result = this.cache.get(this.cacheKey(entry));
    if (!result) return undefined;
    if (Date.now() - result.checkedAt.getTime() > maxAgeMs) {
      this.cache.delete(this.cacheKey(entry));
      return undefined;
    }
    return result;
  }

  /** Clear all cached results */
  clearCache(): void {
    this.cache.clear();
  }

  // ─── Tier 1: Lightweight checks ───────────────────────────

  /**
   * Tier 1 check: fast, safe, no side effects.
   * - Stdio: checks if command binary exists on PATH via `which`
   * - HTTP: sends a fetch HEAD probe with timeout
   */
  async checkTier1(entry: McpServerEntry): Promise<HealthCheckResult> {
    if (!entry.enabled) {
      return this.makeResult(HealthStatus.Unknown, 1);
    }

    const start = Date.now();
    let result: HealthCheckResult;

    if (isStdioConfig(entry.config)) {
      result = await this.tier1Stdio(entry.config, start);
    } else if (isHttpConfig(entry.config)) {
      result = await this.tier1Http(entry.config, start);
    } else {
      result = this.makeResult(HealthStatus.Unknown, 1);
    }

    this.cache.set(this.cacheKey(entry), result);
    return result;
  }

  private async tier1Stdio(config: StdioServerConfig, start: number): Promise<HealthCheckResult> {
    try {
      const resolved = which.sync(config.command, { nothrow: true });

      if (resolved) {
        return {
          ...this.makeResult(HealthStatus.BinaryFound, 1),
          latencyMs: Date.now() - start,
        };
      } else {
        return {
          ...this.makeResult(HealthStatus.CommandNotFound, 1),
          latencyMs: Date.now() - start,
          error: `Command "${config.command}" not found on PATH`,
        };
      }
    } catch {
      return {
        ...this.makeResult(HealthStatus.Error, 1),
        latencyMs: Date.now() - start,
        error: "Failed to check command existence",
      };
    }
  }

  private async tier1Http(config: HttpServerConfig, start: number): Promise<HealthCheckResult> {
    try {
      const response = await fetch(config.url, {
        method: "HEAD",
        headers: config.headers,
        signal: AbortSignal.timeout(TIER1_HTTP_TIMEOUT_MS),
      });

      const latencyMs = Date.now() - start;

      if (response.status === 401 || response.status === 403) {
        return {
          ...this.makeResult(HealthStatus.AuthFailed, 1),
          latencyMs,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      // Any response (even 404/405) means the server is reachable
      return {
        ...this.makeResult(HealthStatus.Reachable, 1),
        latencyMs,
      };
    } catch (error) {
      return {
        ...this.makeResult(HealthStatus.Unreachable, 1),
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Tier 2: Full MCP SDK health check ────────────────────

  /**
   * Tier 2 check: full MCP handshake + ping via SDK.
   * Creates a temporary MCP client, connects, pings, optionally lists tools, then closes.
   */
  async checkTier2(entry: McpServerEntry): Promise<HealthCheckResult> {
    if (!entry.enabled) {
      return this.makeResult(HealthStatus.Unknown, 2);
    }

    const start = Date.now();
    const connectTimeout = await this.settingsService.get("healthCheckTimeoutMs");
    let client: Client | undefined;

    try {
      client = new Client(
        { name: "mcp-manager-health-check", version: "0.1.0" },
        { capabilities: {} },
      );

      if (isStdioConfig(entry.config)) {
        const transport = new StdioClientTransport({
          command: entry.config.command,
          args: entry.config.args ?? [],
          env: entry.config.env
            ? { ...process.env, ...entry.config.env } as Record<string, string>
            : undefined,
          cwd: entry.config.cwd,
        });

        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Connection timed out")), connectTimeout),
          ),
        ]);
      } else if (isHttpConfig(entry.config)) {
        const transport = new StreamableHTTPClientTransport(
          new URL(entry.config.url),
          {
            requestInit: entry.config.headers
              ? { headers: entry.config.headers }
              : undefined,
          },
        );

        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Connection timed out")), connectTimeout),
          ),
        ]);
      } else {
        return this.makeResult(HealthStatus.Unknown, 2);
      }

      // Ping to verify ongoing health
      await client.ping({ timeout: TIER2_PING_TIMEOUT_MS });

      // Optionally get tool count
      let toolCount: number | undefined;
      try {
        const tools = await client.listTools({ timeout: TIER2_PING_TIMEOUT_MS });
        toolCount = tools.tools.length;
      } catch {
        // listTools failure is non-fatal
      }

      const latencyMs = Date.now() - start;

      const result: HealthCheckResult = {
        status: HealthStatus.Healthy,
        latencyMs,
        toolCount,
        checkedAt: new Date(),
        tier: 2,
      };

      this.cache.set(this.cacheKey(entry), result);
      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Classify error
      let status = HealthStatus.Error;
      if (errorMsg.includes("401") || errorMsg.includes("403") || errorMsg.includes("Unauthorized")) {
        status = HealthStatus.AuthFailed;
      } else if (errorMsg.includes("ENOENT")) {
        status = HealthStatus.CommandNotFound;
      } else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
        status = HealthStatus.Unreachable;
      }

      const result: HealthCheckResult = {
        status,
        latencyMs,
        error: errorMsg,
        checkedAt: new Date(),
        tier: 2,
      };

      this.cache.set(this.cacheKey(entry), result);
      return result;
    } finally {
      try {
        await client?.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private makeResult(status: HealthStatus, tier: 1 | 2): HealthCheckResult {
    return { status, checkedAt: new Date(), tier };
  }
}
