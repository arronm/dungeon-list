import { describe, expect, it } from "vitest";
import { parseCharacterDetails, serializeCharacterDetails } from "../src/characterDetails.js";

describe("queue character details", () => {
  it("round trips structured character data through the legacy storage field", () => {
    const stored = serializeCharacterDetails({
      role: "healer",
      realm: "Wyrmrest Accord",
      characterName: "Lightwell",
      keyIntent: "offer",
      dungeon: "Skyreach",
      keyLevel: 12
    });

    expect(parseCharacterDetails(stored)).toEqual({
      realm: "Wyrmrest Accord",
      characterName: "Lightwell",
      keyIntent: "offer",
      dungeon: "Skyreach",
      keyLevel: 12
    });
  });

  it("reads v1 character data without inventing key details", () => {
    expect(parseCharacterDetails('character:v1:["Illidan","Oldrun"]')).toEqual({
      realm: "Illidan",
      characterName: "Oldrun",
      keyIntent: null,
      dungeon: "",
      keyLevel: null
    });
  });

  it("ignores legacy notes and malformed structured data", () => {
    const emptyDetails = {
      realm: "",
      characterName: "",
      keyIntent: null,
      dungeon: "",
      keyLevel: null
    };
    expect(parseCharacterDetails("Ready for anything.")).toEqual(emptyDetails);
    expect(parseCharacterDetails("character:v1:not-json")).toEqual(emptyDetails);
    expect(parseCharacterDetails("character:v2:not-json")).toEqual(emptyDetails);
  });
});
