import { describe, expect, it } from "vitest";
import {
  canModerateRole,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  setEntryStatusRequestSchema
} from "./queue.js";

describe("queue schemas", () => {
  it("accepts a current North American realm and trims the character name", () => {
    expect(joinQueueRequestSchema.parse({ role: "tank", realm: "Area 52", characterName: "  Bulwark  " })).toEqual({
      role: "tank",
      realm: "Area 52",
      characterName: "Bulwark"
    });
  });

  it("rejects unsupported roles, realms, and character names", () => {
    const validCharacter = { realm: "Area 52", characterName: "Bulwark" };
    expect(() => joinQueueRequestSchema.parse({ ...validCharacter, role: "bard" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ role: "dps", realm: "Not A Realm", characterName: "Bulwark" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ role: "dps", realm: "Area 52", characterName: "x" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ role: "dps", realm: "Area 52", characterName: "x".repeat(13) })).toThrow();
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
});
