import { describe, expect, it } from "vitest";
import { currentDungeonCatalog, requireCurrentDungeon } from "../src/dungeonCatalog.js";
import { ApiError } from "../src/errors.js";

describe("EBS dungeon catalog", () => {
  it("contains unique current-season options with compact labels", () => {
    expect(currentDungeonCatalog.seasonId).toBe("midnight-season-1");
    expect(currentDungeonCatalog.dungeons).toHaveLength(8);
    expect(new Set(currentDungeonCatalog.dungeons.map((dungeon) => dungeon.name)).size).toBe(8);
    expect(currentDungeonCatalog.dungeons.every((dungeon) => dungeon.shortName.length > 0)).toBe(true);
  });

  it("allows current dungeons and Any only for key requests", () => {
    expect(() => requireCurrentDungeon("Skyreach", false)).not.toThrow();
    expect(() => requireCurrentDungeon("Any", true)).not.toThrow();
    expect(() => requireCurrentDungeon("Any", false)).toThrow(ApiError);
  });

  it("rejects retired or fabricated dungeon submissions", () => {
    try {
      requireCurrentDungeon("Deadmines", true);
      throw new Error("Expected requireCurrentDungeon to reject the dungeon.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: "unsupported_dungeon"
      });
    }
  });
});
