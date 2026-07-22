import { describe, expect, it } from "vitest";
import {
  canModerateRole,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  offerKeyRequestSchema,
  setEntryStatusRequestSchema
} from "./queue.js";
import { getMythicPlusDungeonShortName, mythicPlusDungeons } from "./dungeons.js";

describe("queue schemas", () => {
  it("accepts a current North American realm and trims the character name", () => {
    expect(
      joinQueueRequestSchema.parse({
        role: "tank",
        realm: "Area 52",
        characterName: "  Bulwark  ",
        keyIntent: "need",
        dungeon: "Skyreach",
        keyLevel: 12
      })
    ).toEqual({
      role: "tank",
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 12
    });
  });

  it("rejects unsupported roles, realms, and character names", () => {
    const validCharacter = {
      realm: "Area 52",
      characterName: "Bulwark",
      keyIntent: "need",
      dungeon: "Skyreach",
      keyLevel: 10
    };
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "bard" })).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", realm: "Not A Realm" })
    ).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", characterName: "x" })
    ).toThrow();
    expect(() =>
      joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", characterName: "x".repeat(13) })
    ).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", keyIntent: "maybe" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", dungeon: "Deadmines" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", keyLevel: 1 })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "dps", keyLevel: 10.5 })).toThrow();
  });

  it("keeps queue requests and key offers as separate operations", () => {
    const signup = {
      role: "dps",
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

  it("allows any dungeon for requests but requires a specific offered key", () => {
    const signup = {
      role: "dps",
      realm: "Area 52",
      characterName: "Keyrunner",
      dungeon: "Any",
      keyLevel: 10
    };

    expect(joinQueueRequestSchema.parse({ ...signup, keyIntent: "need" }).dungeon).toBe("Any");
    expect(() => offerKeyRequestSchema.parse({ ...signup, keyIntent: "offer" })).toThrow();
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

  it("provides a compact label for every current dungeon", () => {
    expect(mythicPlusDungeons.map(getMythicPlusDungeonShortName)).toEqual([
      "MT",
      "Cavern",
      "Xenas",
      "Spire",
      "AA",
      "Pit",
      "Seat",
      "Sky"
    ]);
  });
});
