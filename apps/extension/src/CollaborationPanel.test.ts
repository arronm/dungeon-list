import { describe, expect, it } from "vitest";
import { getCollaborationSummary } from "./CollaborationPanel.js";

describe("collaboration module summary", () => {
  it("keeps each Live Config state compact while collapsed", () => {
    expect(getCollaborationSummary(undefined)).toBe("Loading status…");
    expect(getCollaborationSummary({ state: "standalone" })).toBe("Not sharing this queue");
    expect(getCollaborationSummary({
      state: "pending-host-invite",
      collaboratorDisplayName: "PartyPartner",
      code: "HOST42",
      expiresAt: "2026-08-08T12:00:00.000Z"
    })).toBe("Invite pending for PartyPartner");
    expect(getCollaborationSummary({
      state: "active",
      role: "host",
      hostDisplayName: "DungeonHost",
      collaboratorDisplayName: "PartyPartner"
    })).toBe("DungeonHost + PartyPartner");
  });
});
