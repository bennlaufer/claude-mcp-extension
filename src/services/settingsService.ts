import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { McpManagerSettings, SETTINGS_DEFAULTS } from "../types";

export class SettingsService {
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(os.homedir(), ".claude", "mcp-manager-settings.json");
  }

  /** Read a single setting, returning the default if missing/corrupt */
  async get<K extends keyof McpManagerSettings>(key: K): Promise<McpManagerSettings[K]> {
    const all = await this.readAll();
    return all[key] ?? SETTINGS_DEFAULTS[key];
  }

  /** Write a single setting (read-modify-write to preserve other keys) */
  async set<K extends keyof McpManagerSettings>(key: K, value: McpManagerSettings[K]): Promise<void> {
    const all = await this.readAll();
    all[key] = value;
    await this.writeAll(all);
  }

  /** Read all settings, merged with defaults */
  async getAll(): Promise<McpManagerSettings> {
    const raw = await this.readAll();
    return { ...SETTINGS_DEFAULTS, ...raw };
  }

  private async readAll(): Promise<Partial<McpManagerSettings>> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async writeAll(data: Partial<McpManagerSettings>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
}
