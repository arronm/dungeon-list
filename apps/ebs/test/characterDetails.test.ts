import { describe, expect, it } from "vitest";
import { parseCharacterDetails, serializeCharacterDetails } from "../src/characterDetails.js";

describe("queue character details", () => {
  it("round trips structured character data through the legacy storage field", () => {
    const stored = serializeCharacterDetails({
      roles: ["healer", "dps"],
      realm: "Wyrmrest Accord",
      characterName: "Lightwell",
      keyIntent: "offer",
      dungeon: "Skyreach",
      keyLevel: 12
    });

    expect(parseCharacterDetails(stored)).toEqual({
      roles: ["healer", "dps"],
      realm: "Wyrmrest Accord",
      characterName: "Lightwell",
      keyIntent: "offer",
      dungeon: "Skyreach",
      keyLevel: 12
    });
  });

  it("round trips a request for any dungeon", () => {
    const stored = serializeCharacterDetails({
      roles: ["dps"],
      realm: "Area 52",
      characterName: "Keyrunner",
      keyIntent: "need",
      dungeon: "Any",
      keyLevel: 10
    });

    expect(parseCharacterDetails(stored)).toMatchObject({
      roles: ["dps"],
      keyIntent: "need",
      dungeon: "Any",
      keyLevel: 10
    });
  });

  it("reads v1 character data without inventing key details", () => {
    expect(parseCharacterDetails('character:v1:["Illidan","Oldrun"]')).toEqual({
      roles: [],
      realm: "Illidan",
      characterName: "Oldrun",
      keyIntent: null,
      dungeon: "",
      keyLevel: null
    });
  });

  it("reads v2 signup data without inventing additional roles", () => {
    expect(
      parseCharacterDetails('character:v2:["Area 52","Keyrunner","need","Any",10]')
    ).toMatchObject({
      roles: [],
      keyIntent: "need",
      dungeon: "Any",
      keyLevel: 10
    });
  });

  it("ignores legacy notes and malformed structured data", () => {
    const emptyDetails = {
      roles: [],
      realm: "",
      characterName: "",
      keyIntent: null,
      dungeon: "",
      keyLevel: null
    };
    expect(parseCharacterDetails("Ready for anything.")).toEqual(emptyDetails);
    expect(parseCharacterDetails("character:v1:not-json")).toEqual(emptyDetails);
    expect(parseCharacterDetails("character:v2:not-json")).toEqual(emptyDetails);
    expect(parseCharacterDetails("character:v3:not-json")).toEqual(emptyDetails);
  });
});
