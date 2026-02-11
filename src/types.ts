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
