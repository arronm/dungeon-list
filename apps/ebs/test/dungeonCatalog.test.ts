import { describe, expect, it } from "vitest";
import { currentDungeonCatalog, requireCurrentDungeon } from "../src/dungeonCatalog.js";
import { ApiError } from "../src/errors.js";

describe("EBS dungeon catalog", () => {
  it("contains unique current-season options with compact labels", () => {
    expect(currentDungeonCatalog).toEqual({
      seasonId: "midnight-season-2",
      seasonName: "Midnight Season 2",
      dungeons: [
        { name: "Altar of Fangs", shortName: "ALTAR" },
        { name: "Den of Nalorakk", shortName: "DEN" },
        { name: "Murder Row", shortName: "MURDER" },
        { name: "The Blinding Vale", shortName: "VALE" },
        { name: "Voidscar Arena", shortName: "ARENA" },
        { name: "King's Rest", shortName: "REST" },
        { name: "Temple of Sethraliss", shortName: "TEMPLE" },
        { name: "Ruby Life Pools", shortName: "POOLS" }
      ]
    });
    expect(new Set(currentDungeonCatalog.dungeons.map((dungeon) => dungeon.name)).size).toBe(8);
    expect(currentDungeonCatalog.dungeons.every((dungeon) => dungeon.shortName.length > 0)).toBe(true);
  });

  it("allows current dungeons and Any only for key requests", () => {
    expect(() => requireCurrentDungeon("Altar of Fangs", false)).not.toThrow();
    expect(() => requireCurrentDungeon("Any", true)).not.toThrow();
    expect(() => requireCurrentDungeon("Any", false)).toThrow(ApiError);
  });

  it("rejects retired or fabricated dungeon submissions", () => {
    expect(() => requireCurrentDungeon("Skyreach", true)).toThrow(ApiError);
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
