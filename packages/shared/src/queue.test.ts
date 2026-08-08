import { describe, expect, it } from "vitest";
import {
  canModerateRole,
  getCharacterIdentityKey,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  offerKeyRequestSchema,
  setEntryStatusRequestSchema
} from "./queue.js";
import {
  dungeonCatalogSchema,
  getMythicPlusDungeonShortName,
  isDungeonInCatalog
} from "./dungeons.js";

const testDungeonCatalog = dungeonCatalogSchema.parse({
  seasonId: "test-season",
  seasonName: "Test Season",
  dungeons: [
    { name: "Skyreach", shortName: "Sky" },
    { name: "Windrunner Spire", shortName: "Spire" }
  ]
});

describe("queue schemas", () => {
  it("accepts a current North American realm and trims the character name", () => {
    expect(
      joinQueueRequestSchema.parse({
        roles: ["tank", "healer"],
        realm: "Area 52",
        characterName: "  Bulwark  ",
        keyIntent: "need",
        dungeon: "Skyreach",
        keyLevel: 12
      })
    ).toEqual({
      roles: ["tank", "healer"],
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });
  });

  it("rejects unsupported roles, realms, character names, and malformed dungeon names", () => {
    const validCharacter = {
      roles: ["dps"],
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 10
    };
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, roles: ["bard"] })).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, realm: "Not A Realm" })
    ).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, characterName: "x" })
    ).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, characterName: "x".repeat(13) })
    ).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, keyIntent: "maybe" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, dungeon: "   " })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, dungeon: "x".repeat(81) })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, keyLevel: 1 })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, keyLevel: 10.5 })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, roles: [] })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, roles: ["dps", "dps"] })).toThrow();
  });

  it("normalizes legacy single-role requests during rollout", () => {
    const parsed = joinQueueRequestSchema.parse({
      role: "tank",
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 10
    });

    expect(parsed.roles).toEqual(["tank"]);
    expect(parsed).not.toHaveProperty("role");
  });

  it("keeps queue requests and key offers as separate operations", () => {
    const signup = {
      roles: ["healer", "dps"],
      realm: "Area 52",
      characterName: "Keyrunner",
      dungeon: "Windrunner Spire",
      keyLevel: 12
    };

    expect(joinQueueRequestSchema.parse({ ...signup, keyIntent: "need" }).keyIntent).toBe("need");
    expect(offerKeyRequestSchema.parse({ ...signup, keyIntent: "offer" }).keyIntent).toBe("offer");
    expect(() => joinQueueRequestSchema.parse({ ...signup, keyIntent: "offer" })).toThrow();
    expect(() => offerKeyRequestSchema.parse({ ...signup, keyIntent: "need" })).toThrow();
  });

  it("matches character identities without name casing but keeps realms distinct", () => {
    const area52Key = getCharacterIdentityKey({
      realm: "Area 52",
      characterName: "Keyrunner"
    });

    expect(
      getCharacterIdentityKey({
        realm: "Area 52",
        characterName: "keyRUNNER"
      })
    ).toBe(area52Key);
    expect(
      getCharacterIdentityKey({
        realm: "Illidan",
        characterName: "Keyrunner"
      })
    ).not.toBe(area52Key);
  });

  it("allows any dungeon for requests but requires a specific offered key", () => {
    const signup = {
      roles: ["dps"],
      realm: "Area 52",
      characterName: "Keyrunner",
      dungeon: "Any",
      keyLevel: 10
    };

    expect(joinQueueRequestSchema.parse({ ...signup, keyIntent: "need" }).dungeon).toBe("Any");
    expect(() => offerKeyRequestSchema.parse({ ...signup, keyIntent: "offer" })).toThrow();
  });

  it("leaves seasonal membership to the EBS catalog", () => {
    const retiredDungeonRequest = joinQueueRequestSchema.parse({
      roles: ["dps"],
      realm: "Area 52",
      characterName: "Keyrunner",
      keyIntent: "need",
      dungeon: "Retired Dungeon",
      keyLevel: 10
    });

    expect(retiredDungeonRequest.dungeon).toBe("Retired Dungeon");
    expect(isDungeonInCatalog(retiredDungeonRequest.dungeon, testDungeonCatalog, true)).toBe(false);
    expect(isDungeonInCatalog("Any", testDungeonCatalog, true)).toBe(true);
  });

  it("accepts only supported moderation transitions", () => {
    expect(setEntryStatusRequestSchema.parse({ status: "invited" }).status).toBe("invited");
    expect(moveEntryRequestSchema.parse({ direction: "up" }).direction).toBe("up");
    expect(() => setEntryStatusRequestSchema.parse({ status: "deleted" })).toThrow();
  });

  it("treats broadcaster and moderator as queue managers", () => {
    expect(canModerateRole("viewer")).toBe(false);
    expect(canModerateRole("moderator")).toBe(true);
    expect(canModerateRole("broadcaster")).toBe(true);
  });

  it("validates and formats an EBS-provided dungeon catalog", () => {
    expect(testDungeonCatalog.dungeons.map((dungeon) =>
      getMythicPlusDungeonShortName(dungeon.name, testDungeonCatalog.dungeons)
    )).toEqual(["Sky", "Spire"]);
    expect(getMythicPlusDungeonShortName("Legacy Dungeon", testDungeonCatalog.dungeons)).toBe(
      "Legacy Dungeon"
    );
    expect(() => dungeonCatalogSchema.parse({
      ...testDungeonCatalog,
      dungeons: [
        { name: "Skyreach", shortName: "Sky" },
        { name: "skyreach", shortName: "Duplicate" }
      ]
    })).toThrow();
    expect(() => dungeonCatalogSchema.parse({
      ...testDungeonCatalog,
      dungeons: [{ name: "Any", shortName: "Any" }]
    })).toThrow();
  });
});
