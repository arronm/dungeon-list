import {
  anyMythicPlusDungeon,
  type KeyOfferDto,
  type QueueEntryDto
} from "@dungeon-list/shared";

type KeyRequest = Pick<QueueEntryDto, "keyIntent" | "dungeon" | "keyLevel">;

export type KeyAvailability = "exact" | "higher" | "none";

export function isMatchableKeyRequest(request: KeyRequest): boolean {
  return request.keyIntent === "need" && Boolean(request.dungeon) && request.keyLevel !== null;
}

export function getMatchingKeyOffers(
  request: KeyRequest,
  offers: readonly KeyOfferDto[]
): KeyOfferDto[] {
  if (!isMatchableKeyRequest(request)) {
    return [];
  }

  return offers.filter(
    (offer) =>
      offer.keyLevel === request.keyLevel &&
      hasMatchingDungeon(request, offer)
  );
}

export function getHigherLevelKeyOffers(
  request: KeyRequest,
  offers: readonly KeyOfferDto[]
): KeyOfferDto[] {
  const requestedLevel = request.keyLevel;
  if (!isMatchableKeyRequest(request) || requestedLevel === null) {
    return [];
  }

  return offers
    .filter(
      (offer) =>
        offer.keyLevel !== null &&
        offer.keyLevel > requestedLevel &&
        hasMatchingDungeon(request, offer)
    )
    .sort((a, b) => (a.keyLevel ?? 0) - (b.keyLevel ?? 0));
}

export function getAvailableKeyOffers(
  request: KeyRequest,
  offers: readonly KeyOfferDto[]
): KeyOfferDto[] {
  return [
    ...getMatchingKeyOffers(request, offers),
    ...getHigherLevelKeyOffers(request, offers)
  ];
}

export function getKeyAvailability(
  request: KeyRequest,
  offers: readonly KeyOfferDto[]
): KeyAvailability | null {
  const requestedLevel = request.keyLevel;
  if (!isMatchableKeyRequest(request) || requestedLevel === null) {
    return null;
  }

  let hasHigherLevelKey = false;
  for (const offer of offers) {
    if (offer.keyLevel === null || !hasMatchingDungeon(request, offer)) {
      continue;
    }
    if (offer.keyLevel === requestedLevel) {
      return "exact";
    }
    if (offer.keyLevel > requestedLevel) {
      hasHigherLevelKey = true;
    }
  }

  return hasHigherLevelKey ? "higher" : "none";
}

function hasMatchingDungeon(request: KeyRequest, offer: KeyOfferDto): boolean {
  return request.dungeon === anyMythicPlusDungeon || offer.dungeon === request.dungeon;
}
