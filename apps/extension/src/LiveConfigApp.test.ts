import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { LiveConfigApp } from "./LiveConfigApp.js";

describe("LiveConfigApp composition", () => {
  it("keeps the complete Dungeon List manager and adds collaboration controls", () => {
    const element = LiveConfigApp();
    expect(element.type).toBe(App);
    expect(element.props).toMatchObject({ showCollaborationPanel: true });
  });
});
