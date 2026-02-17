import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mock functions ---
const { mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

import { SettingsService } from "./settingsService";
import { SETTINGS_DEFAULTS } from "../types";

describe("SettingsService", () => {
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SettingsService();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  // ─── get() ──────────────────────────────────────────────

  describe("get", () => {
    it("returns default when file doesn't exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const value = await service.get("autoHealthCheck");
      expect(value).toBe(SETTINGS_DEFAULTS.autoHealthCheck);
    });

    it("returns default when file is corrupt JSON", async () => {
      mockReadFile.mockResolvedValue("not valid json {{{");

      const value = await service.get("healthCheckTimeoutMs");
      expect(value).toBe(SETTINGS_DEFAULTS.healthCheckTimeoutMs);
    });

    it("returns stored value when file exists", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ autoHealthCheck: "httpOnly" }));

      const value = await service.get("autoHealthCheck");
      expect(value).toBe("httpOnly");
    });

    it("returns default for missing key when file has other keys", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ autoHealthCheck: "none" }));

      const value = await service.get("healthCheckTimeoutMs");
      expect(value).toBe(SETTINGS_DEFAULTS.healthCheckTimeoutMs);
    });
  });

  // ─── set() ──────────────────────────────────────────────

  describe("set", () => {
    it("creates file and directory if they don't exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      await service.set("autoHealthCheck", "none");

      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("mcp-manager-settings.json"),
        expect.any(String),
        "utf-8",
      );
    });

    it("preserves other keys (read-modify-write)", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ autoHealthCheck: "httpOnly" }));

      await service.set("healthCheckTimeoutMs", 5000);

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1].trim());
      expect(writtenContent.autoHealthCheck).toBe("httpOnly");
      expect(writtenContent.healthCheckTimeoutMs).toBe(5000);
    });
  });

  // ─── getAll() ───────────────────────────────────────────

  describe("getAll", () => {
    it("merges defaults with stored values", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ autoHealthCheck: "none" }));

      const all = await service.getAll();

      expect(all.autoHealthCheck).toBe("none");
      expect(all.healthCheckTimeoutMs).toBe(SETTINGS_DEFAULTS.healthCheckTimeoutMs);
    });

    it("returns all defaults when file is missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const all = await service.getAll();

      expect(all).toEqual(SETTINGS_DEFAULTS);
    });
  });
});
