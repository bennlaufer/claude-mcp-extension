/**
 * Scope of an MCP server configuration.
 * - project: from `.mcp.json` at workspace root (toggled via settings file)
 * - user: from `~/.claude.json` top-level `mcpServers`
 * - local: from `~/.claude.json` → `projects["/path"].mcpServers`
 * - managed: enterprise/admin-managed (read-only)
 */
export type McpScope = "project" | "user" | "local" | "managed";

/** stdio-based MCP server configuration */
export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** HTTP/SSE-based MCP server configuration */
export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

/** Union of possible server config shapes */
export type McpServerConfig = StdioServerConfig | HttpServerConfig;

/** A resolved MCP server entry with metadata */
export interface McpServerEntry {
  /** Display name (key in the mcpServers object) */
  name: string;
  /** Raw configuration object */
  config: McpServerConfig;
  /** Which scope this server comes from */
  scope: McpScope;
  /** Whether the server is currently enabled */
  enabled: boolean;
  /** Absolute path to the config file that owns this entry */
  configFilePath: string;
  /** Plugin ID (e.g., "playwright@claude-plugins-official"). Present only for plugin-sourced servers. */
  pluginId?: string;
}

/** Describes where a config was loaded from */
export interface ConfigSource {
  scope: McpScope;
  filePath: string;
}

// --- Config file shapes ---

/** Shape of `.mcp.json` */
export interface McpJsonConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

/** Shape of `.claude/settings.local.json` */
export interface SettingsLocal {
  disabledMcpjsonServers?: string[];
  [key: string]: unknown;
}

/** Per-project block inside `~/.claude.json` */
export interface ClaudeProjectConfig {
  mcpServers?: Record<string, McpServerConfig>;
  _disabled_mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

/** Shape of `~/.claude.json` */
export interface ClaudeGlobalConfig {
  mcpServers?: Record<string, McpServerConfig>;
  _disabled_mcpServers?: Record<string, McpServerConfig>;
  projects?: Record<string, ClaudeProjectConfig>;
  [key: string]: unknown;
}

/** Shape of managed MCP config */
export interface ManagedMcpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

// --- Plugin types ---

export interface PluginInstallation {
  scope: "project" | "global";
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha: string;
}

export interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginInstallation[] | PluginInstallation>;
}

export interface PluginMetadata {
  name: string;
  description?: string;
  version?: string;
  author?: { name: string; email?: string };
}

export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

// --- Type guards ---

export function isStdioConfig(config: McpServerConfig): config is StdioServerConfig {
  return "command" in config;
}

export function isHttpConfig(config: McpServerConfig): config is HttpServerConfig {
  return "url" in config;
}

// --- Extension settings types ---

/** All extension settings with their types */
export interface McpManagerSettings {
  autoHealthCheck: "none" | "httpOnly" | "all";
  healthCheckTimeoutMs: number;
}

/** Default values for all settings */
export const SETTINGS_DEFAULTS: McpManagerSettings = {
  autoHealthCheck: "all",
  healthCheckTimeoutMs: 15000,
};

/** Metadata for rendering a setting in the TreeView */
export interface SettingDefinition<K extends keyof McpManagerSettings = keyof McpManagerSettings> {
  key: K;
  label: string;
  description: string;
  type: "enum" | "number";
  options?: { label: string; description: string }[];
  min?: number;
  max?: number;
}

/** Registry of all setting definitions (used by UI layer) */
export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "autoHealthCheck",
    label: "Auto Health Check",
    description: "Which servers to auto-check on refresh",
    type: "enum",
    options: [
      { label: "all", description: "Auto-check all servers on refresh" },
      { label: "httpOnly", description: "Auto-check HTTP servers only" },
      { label: "none", description: "No automatic health checks" },
    ],
  },
  {
    key: "healthCheckTimeoutMs",
    label: "Health Check Timeout",
    description: "Timeout for deep health checks (ms)",
    type: "number",
    min: 1000,
    max: 120000,
  },
];

// --- Claude Code settings types ---

export interface ClaudeCodeSettings {
  toolSearchMode: "auto" | "true" | "false";
}

export const CLAUDE_CODE_SETTINGS_DEFAULTS: ClaudeCodeSettings = {
  toolSearchMode: "auto",
};

export interface ClaudeCodeSettingDefinition<K extends keyof ClaudeCodeSettings = keyof ClaudeCodeSettings> {
  key: K;
  label: string;
  description: string;
  type: "enum";
  options: { label: string; description: string }[];
  envVar: string;
}

export const CLAUDE_CODE_SETTING_DEFINITIONS: ClaudeCodeSettingDefinition[] = [
  {
    key: "toolSearchMode",
    label: "Tool Search",
    description: "When to activate MCP tool search (reduces context usage)",
    type: "enum",
    options: [
      { label: "auto", description: "Enable when context window reaches 10% capacity (default)" },
      { label: "true", description: "Always enabled (recommended)" },
      { label: "false", description: "Disabled — all tool definitions loaded upfront" },
    ],
    envVar: "ENABLE_TOOL_SEARCH",
  },
];

// --- Health check types ---

export enum HealthStatus {
  /** Not yet checked */
  Unknown = "unknown",
  /** Currently running a check */
  Checking = "checking",
  /** Tier 1 stdio: command binary found on PATH */
  BinaryFound = "binary_found",
  /** Tier 1 stdio: command binary NOT found on PATH */
  CommandNotFound = "command_not_found",
  /** Tier 1 HTTP: endpoint responded to probe */
  Reachable = "reachable",
  /** Tier 1 HTTP: endpoint did not respond */
  Unreachable = "unreachable",
  /** Tier 2: full MCP handshake + ping succeeded */
  Healthy = "healthy",
  /** Tier 2: MCP connection established but ping failed or server error */
  Degraded = "degraded",
  /** Tier 2: authentication/authorization failure (HTTP 401/403) */
  AuthFailed = "auth_failed",
  /** Tier 2: connection failed for other reasons */
  Error = "error",
}

/** Sort priority for health statuses: 0=good, 1=checking, 2=unknown, 3=error/offline */
export const HEALTH_SORT_PRIORITY: Record<HealthStatus, number> = {
  [HealthStatus.Healthy]: 0,
  [HealthStatus.BinaryFound]: 0,
  [HealthStatus.Reachable]: 0,
  [HealthStatus.Checking]: 1,
  [HealthStatus.Unknown]: 2,
  [HealthStatus.Degraded]: 3,
  [HealthStatus.CommandNotFound]: 3,
  [HealthStatus.Unreachable]: 3,
  [HealthStatus.AuthFailed]: 3,
  [HealthStatus.Error]: 3,
};

/** Default sort priority for servers with no health result */
export const HEALTH_SORT_PRIORITY_DEFAULT = 2;

export interface HealthCheckResult {
  status: HealthStatus;
  /** Time the check took in milliseconds */
  latencyMs?: number;
  /** Number of tools the server exposes (from Tier 2 listTools) */
  toolCount?: number;
  /** Error message if status is error/degraded/auth_failed */
  error?: string;
  /** Server name+version from MCP initialize response */
  serverInfo?: { name: string; version: string };
  /** Timestamp when this check was performed */
  checkedAt: Date;
  /** Which tier produced this result */
  tier: 1 | 2;
}
