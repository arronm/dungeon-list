import { describe, expect, it } from "vitest";
import { formatInviteCommand } from "./invite.js";

describe("invite command", () => {
  it.each([
    ["Bulwark", "Area 52", "/invite Bulwark-Area52"],
    ["Lightwell", "Wyrmrest Accord", "/invite Lightwell-WyrmrestAccord"],
    ["Backstab", "Blade's Edge", "/invite Backstab-BladesEdge"],
    ["Frostbolt", "Azjol-Nerub", "/invite Frostbolt-AzjolNerub"]
  ])("formats %s on %s", (characterName, realm, expected) => {
    expect(formatInviteCommand(characterName, realm)).toBe(expected);
  });
});
