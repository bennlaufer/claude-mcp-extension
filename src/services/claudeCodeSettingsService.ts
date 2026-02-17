import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  ClaudeCodeSettings,
  CLAUDE_CODE_SETTINGS_DEFAULTS,
  CLAUDE_CODE_SETTING_DEFINITIONS,
} from "../types";

/**
 * Reads/writes Claude Code settings stored as env vars in ~/.claude/settings.json.
 * Mirrors SettingsService pattern but operates on the `env` field.
 */
export class ClaudeCodeSettingsService {
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(os.homedir(), ".claude", "settings.json");
  }

  /** Read a single Claude Code setting, returning the default if missing/unrecognized */
  async get<K extends keyof ClaudeCodeSettings>(key: K): Promise<ClaudeCodeSettings[K]> {
    const def = CLAUDE_CODE_SETTING_DEFINITIONS.find((d) => d.key === key);
    if (!def) return CLAUDE_CODE_SETTINGS_DEFAULTS[key];

    const env = await this.readEnv();
    const raw = env[def.envVar];

    if (raw === undefined) return CLAUDE_CODE_SETTINGS_DEFAULTS[key];

    // Validate against known options
    const validValues = def.options.map((o) => o.label);
    if (validValues.includes(raw)) {
      return raw as ClaudeCodeSettings[K];
    }

    // Unrecognized value — fall back to default
    return CLAUDE_CODE_SETTINGS_DEFAULTS[key];
  }

  /** Write a single Claude Code setting. Removes the env var when value matches default. */
  async set<K extends keyof ClaudeCodeSettings>(key: K, value: ClaudeCodeSettings[K]): Promise<void> {
    const def = CLAUDE_CODE_SETTING_DEFINITIONS.find((d) => d.key === key);
    if (!def) return;

    const file = await this.readFile();
    const env: Record<string, string> = (file.env as Record<string, string>) ?? {};

    if (value === CLAUDE_CODE_SETTINGS_DEFAULTS[key]) {
      delete env[def.envVar];
    } else {
      env[def.envVar] = String(value);
    }

    // Clean up empty env object
    if (Object.keys(env).length === 0) {
      delete file.env;
    } else {
      file.env = env;
    }

    await this.writeFile(file);
  }

  /** Read all Claude Code settings, merged with defaults */
  async getAll(): Promise<ClaudeCodeSettings> {
    const result = { ...CLAUDE_CODE_SETTINGS_DEFAULTS };
    const env = await this.readEnv();

    for (const def of CLAUDE_CODE_SETTING_DEFINITIONS) {
      const raw = env[def.envVar];
      if (raw !== undefined) {
        const validValues = def.options.map((o) => o.label);
        if (validValues.includes(raw)) {
          (result as any)[def.key] = raw;
        }
      }
    }

    return result;
  }

  private async readEnv(): Promise<Record<string, string>> {
    const file = await this.readFile();
    return (file.env as Record<string, string>) ?? {};
  }

  private async readFile(): Promise<Record<string, unknown>> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async writeFile(data: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
}
