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

import { ClaudeCodeSettingsService } from "./claudeCodeSettingsService";
import { CLAUDE_CODE_SETTINGS_DEFAULTS } from "../types";

describe("ClaudeCodeSettingsService", () => {
  let service: ClaudeCodeSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaudeCodeSettingsService();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  // ─── get() ──────────────────────────────────────────────

  describe("get", () => {
    it("returns default when file doesn't exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const value = await service.get("toolSearchMode");
      expect(value).toBe(CLAUDE_CODE_SETTINGS_DEFAULTS.toolSearchMode);
    });

    it("returns default when file has no env field", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ enabledPlugins: {} }));

      const value = await service.get("toolSearchMode");
      expect(value).toBe("auto");
    });

    it("returns default for unrecognized env value", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "auto:5" },
      }));

      const value = await service.get("toolSearchMode");
      expect(value).toBe("auto");
    });

    it("returns stored env var value", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "true" },
      }));

      const value = await service.get("toolSearchMode");
      expect(value).toBe("true");
    });

    it("returns 'false' when env var is set to 'false'", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "false" },
      }));

      const value = await service.get("toolSearchMode");
      expect(value).toBe("false");
    });
  });

  // ─── set() ──────────────────────────────────────────────

  describe("set", () => {
    it("writes env var and preserves existing keys", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        enabledPlugins: { "my-plugin": true },
      }));

      await service.set("toolSearchMode", "true");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1].trim());
      expect(written.env.ENABLE_TOOL_SEARCH).toBe("true");
      expect(written.enabledPlugins).toEqual({ "my-plugin": true });
    });

    it("removes env var when value matches default", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "true" },
        enabledPlugins: {},
      }));

      await service.set("toolSearchMode", "auto");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1].trim());
      expect(written.env).toBeUndefined();
      expect(written.enabledPlugins).toEqual({});
    });

    it("cleans up empty env object", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "false" },
      }));

      await service.set("toolSearchMode", "auto");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1].trim());
      expect(written.env).toBeUndefined();
    });

    it("preserves other env vars when removing one", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "true", OTHER_VAR: "value" },
      }));

      await service.set("toolSearchMode", "auto");

      const written = JSON.parse(mockWriteFile.mock.calls[0][1].trim());
      expect(written.env.ENABLE_TOOL_SEARCH).toBeUndefined();
      expect(written.env.OTHER_VAR).toBe("value");
    });

    it("creates directory if it doesn't exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      await service.set("toolSearchMode", "true");

      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("settings.json"),
        expect.any(String),
        "utf-8",
      );
    });
  });

  // ─── getAll() ───────────────────────────────────────────

  describe("getAll", () => {
    it("merges defaults with env values", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "false" },
      }));

      const all = await service.getAll();
      expect(all.toolSearchMode).toBe("false");
    });

    it("returns all defaults when file is missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const all = await service.getAll();
      expect(all).toEqual(CLAUDE_CODE_SETTINGS_DEFAULTS);
    });

    it("returns all defaults when env has unrecognized value", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        env: { ENABLE_TOOL_SEARCH: "auto:5" },
      }));

      const all = await service.getAll();
      expect(all.toolSearchMode).toBe("auto");
    });
  });
});
