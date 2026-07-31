import {
  anyMythicPlusDungeon,
  type KeyOfferDto,
  type QueueEntryDto
} from "@dungeon-list/shared";

type KeyRequest = Pick<QueueEntryDto, "keyIntent" | "dungeon" | "keyLevel">;

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
      (request.dungeon === anyMythicPlusDungeon || offer.dungeon === request.dungeon)
  );
}
