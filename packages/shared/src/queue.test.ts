import { describe, expect, it } from "vitest";
import {
  canModerateRole,
  joinQueueRequestSchema,
  moveEntryRequestSchema,
  setEntryStatusRequestSchema
} from "./queue.js";

describe("queue schemas", () => {
  it("normalizes optional join notes", () => {
    expect(joinQueueRequestSchema.parse({ role: "tank" })).toMatchObject({
      role: "tank",
      note: ""
    });
  });

  it("rejects unsupported roles and oversized notes", () => {
    expect(() => joinQueueRequestSchema.parse({ role: "bard" })).toThrow();
    expect(() => joinQueueRequestSchema.parse({ role: "dps", note: "x".repeat(161) })).toThrow();
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

