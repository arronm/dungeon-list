import { describe, expect, it } from "vitest";
import { parseCharacterDetails, serializeCharacterDetails } from "../src/characterDetails.js";

describe("queue character details", () => {
  it("round trips structured character data through the legacy storage field", () => {
    const stored = serializeCharacterDetails({
      role: "healer",
      realm: "Wyrmrest Accord",
      characterName: "Lightwell"
    });

    expect(parseCharacterDetails(stored)).toEqual({
      realm: "Wyrmrest Accord",
      characterName: "Lightwell"
    });
  });

  it("ignores legacy notes and malformed structured data", () => {
    expect(parseCharacterDetails("Ready for anything.")).toEqual({ realm: "", characterName: "" });
    expect(parseCharacterDetails("character:v1:not-json")).toEqual({ realm: "", characterName: "" });
  });
});
