import { describe, expect, it } from "vitest";
import { getViewerDisplayName, type TwitchViewer } from "./twitch.js";

describe("Twitch viewer helpers", () => {
  it("prefers display name for queue labels", () => {
    const viewer: TwitchViewer = {
      id: "1234",
      displayName: "DungeonRunner"
    };

    expect(getViewerDisplayName(viewer)).toBe("DungeonRunner");
  });

  it("falls back to the Twitch user id", () => {
    expect(getViewerDisplayName({ id: "1234" })).toBe("1234");
  });
});

