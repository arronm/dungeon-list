import { describe, expect, it } from "vitest";
import type { KeyOfferDto, QueueEntryDto } from "@dungeon-list/shared";
import { getMatchingKeyOffers, isMatchableKeyRequest } from "./keyMatching.js";

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

  it("does not match legacy or incomplete queue entries", () => {
    const offers = [createOffer("sky-10", "Skyreach", 10)];

    expect(getMatchingKeyOffers(createRequest({ keyIntent: null }), offers)).toEqual([]);
    expect(getMatchingKeyOffers(createRequest({ keyIntent: "offer" }), offers)).toEqual([]);
    expect(getMatchingKeyOffers(createRequest({ keyLevel: null }), offers)).toEqual([]);
    expect(isMatchableKeyRequest(createRequest())).toBe(true);
  });
});

function createRequest(overrides: Partial<QueueEntryDto> = {}): QueueEntryDto {
  return {
    id: "request-1",
    twitchUserId: "viewer-1",
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
    ...overrides
  };
}

function createOffer(id: string, dungeon: string, keyLevel: number): KeyOfferDto {
  return {
    id,
    twitchUserId: `owner-${id}`,
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
    isCurrentViewer: false
  };
}
