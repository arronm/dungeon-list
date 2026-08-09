import { describe, expect, it } from "vitest";
import type { KeyOfferDto, QueueEntryDto } from "@dungeon-list/shared";
import {
  getAvailableKeyOffers,
  getHigherLevelKeyOffers,
  getKeyAvailability,
  getMatchingKeyOffers,
  isMatchableKeyRequest
} from "./keyMatching.js";

describe("key offer matching", () => {
  it("shows every dungeon at the exact requested level for an Any request", () => {
    const request = createRequest({ dungeon: "Any", keyLevel: 10 });
    const matchingOffers = getMatchingKeyOffers(request, [
      createOffer("sky-10", "Skyreach", 10),
      createOffer("spire-10", "Windrunner Spire", 10),
      createOffer("sky-11", "Skyreach", 11)
    ]);

    expect(matchingOffers.map((offer) => offer.id)).toEqual(["sky-10", "spire-10"]);
  });

  it("requires both the dungeon and exact level for a specific request", () => {
    const request = createRequest({ dungeon: "Skyreach", keyLevel: 10 });
    const matchingOffers = getMatchingKeyOffers(request, [
      createOffer("spire-10", "Windrunner Spire", 10),
      createOffer("sky-10", "Skyreach", 10),
      createOffer("sky-9", "Skyreach", 9)
    ]);

    expect(matchingOffers.map((offer) => offer.id)).toEqual(["sky-10"]);
  });

  it("shows compatible higher-level offers after exact matches", () => {
    const request = createRequest({ dungeon: "Skyreach", keyLevel: 10 });
    const offers = [
      createOffer("sky-12", "Skyreach", 12),
      createOffer("spire-11", "Windrunner Spire", 11),
      createOffer("sky-10", "Skyreach", 10),
      createOffer("sky-11", "Skyreach", 11),
      createOffer("sky-9", "Skyreach", 9)
    ];

    expect(getHigherLevelKeyOffers(request, offers).map((offer) => offer.id)).toEqual([
      "sky-11",
      "sky-12"
    ]);
    expect(getAvailableKeyOffers(request, offers).map((offer) => offer.id)).toEqual([
      "sky-10",
      "sky-11",
      "sky-12"
    ]);
  });

  it("classifies exact, higher-only, and unavailable key requests", () => {
    const request = createRequest({ dungeon: "Skyreach", keyLevel: 10 });

    expect(getKeyAvailability(request, [createOffer("sky-10", "Skyreach", 10)])).toBe("exact");
    expect(getKeyAvailability(request, [createOffer("sky-12", "Skyreach", 12)])).toBe("higher");
    expect(getKeyAvailability(request, [createOffer("sky-9", "Skyreach", 9)])).toBe("none");
    expect(getKeyAvailability(request, [createOffer("spire-12", "Windrunner Spire", 12)])).toBe(
      "none"
    );
  });

  it("prefers exact availability when exact and higher-level keys both exist", () => {
    const request = createRequest({ dungeon: "Any", keyLevel: 10 });
    const offers = [
      createOffer("sky-12", "Skyreach", 12),
      createOffer("spire-10", "Windrunner Spire", 10)
    ];

    expect(getKeyAvailability(request, offers)).toBe("exact");
  });

  it("does not match legacy or incomplete queue entries", () => {
    const offers = [createOffer("sky-10", "Skyreach", 10)];

    expect(getMatchingKeyOffers(createRequest({ keyIntent: null }), offers)).toEqual([]);
    expect(getMatchingKeyOffers(createRequest({ keyIntent: "offer" }), offers)).toEqual([]);
    expect(getMatchingKeyOffers(createRequest({ keyLevel: null }), offers)).toEqual([]);
    expect(getHigherLevelKeyOffers(createRequest({ keyLevel: null }), offers)).toEqual([]);
    expect(getKeyAvailability(createRequest({ keyIntent: null }), offers)).toBeNull();
    expect(isMatchableKeyRequest(createRequest())).toBe(true);
  });
});

function createRequest(overrides: Partial<QueueEntryDto> = {}): QueueEntryDto {
  return {
    id: "request-1",
    displayName: "Key Seeker",
    role: "dps",
    roles: ["dps"],
    realm: "Area 52",
    characterName: "Seekkey",
    keyIntent: "need",
    dungeon: "Any",
    keyLevel: 10,
    status: "waiting",
    position: 1,
    joinedAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    isCurrentViewer: false,
    sourceRole: null,
    ...overrides
  };
}

function createOffer(id: string, dungeon: string, keyLevel: number): KeyOfferDto {
  return {
    id,
    displayName: `Owner ${id}`,
    role: "tank",
    roles: ["tank", "dps"],
    realm: "Area 52",
    characterName: `Character${id}`,
    keyIntent: "offer",
    dungeon,
    keyLevel,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    isCurrentViewer: false,
    sourceRole: null
  };
}
