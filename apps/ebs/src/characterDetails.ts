import type { JoinQueueRequest, OfferKeyRequest, QueueEntryDto } from "@dungeon-list/shared";

const characterDetailsV1Prefix = "character:v1:";
const characterDetailsV2Prefix = "character:v2:";
const characterDetailsV3Prefix = "character:v3:";

type StoredSignupDetails = Pick<
  QueueEntryDto,
  "roles" | "realm" | "characterName" | "keyIntent" | "dungeon" | "keyLevel"
>;

export function serializeCharacterDetails(input: JoinQueueRequest | OfferKeyRequest): string {
  return `${characterDetailsV3Prefix}${JSON.stringify([
    input.realm,
    input.characterName,
    input.keyIntent,
    input.dungeon,
    input.keyLevel,
    input.roles
  ])}`;
}

export function parseCharacterDetails(value: string): StoredSignupDetails {
  if (value.startsWith(characterDetailsV3Prefix)) {
    return parseV3Details(value.slice(characterDetailsV3Prefix.length));
  }

  if (value.startsWith(characterDetailsV2Prefix)) {
    return parseV2Details(value.slice(characterDetailsV2Prefix.length));
  }

  if (value.startsWith(characterDetailsV1Prefix)) {
    return parseV1Details(value.slice(characterDetailsV1Prefix.length));
  }

  return emptyDetails();
}

function parseV3Details(value: string): StoredSignupDetails {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 6 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      (parsed[2] === "need" || parsed[2] === "offer") &&
      typeof parsed[3] === "string" &&
      parsed[3].trim().length > 0 &&
      typeof parsed[4] === "number" &&
      Number.isInteger(parsed[4]) &&
      parsed[4] >= 2 &&
      parsed[4] <= 99 &&
      isStoredRoles(parsed[5])
    ) {
      return {
        realm: parsed[0],
        characterName: parsed[1],
        keyIntent: parsed[2],
        dungeon: parsed[3],
        keyLevel: parsed[4],
        roles: parsed[5]
      };
    }
  } catch {
    // Treat malformed structured data as an entry without signup details.
  }

  return emptyDetails();
}

function parseV2Details(value: string): StoredSignupDetails {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 5 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      (parsed[2] === "need" || parsed[2] === "offer") &&
      typeof parsed[3] === "string" &&
      parsed[3].trim().length > 0 &&
      typeof parsed[4] === "number" &&
      Number.isInteger(parsed[4]) &&
      parsed[4] >= 2 &&
      parsed[4] <= 99
    ) {
      return {
        realm: parsed[0],
        characterName: parsed[1],
        keyIntent: parsed[2],
        dungeon: parsed[3],
        keyLevel: parsed[4],
        roles: []
      };
    }
  } catch {
    // Treat malformed structured data as an entry without signup details.
  }

  return emptyDetails();
}

function parseV1Details(value: string): StoredSignupDetails {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return {
        ...emptyDetails(),
        realm: parsed[0],
        characterName: parsed[1]
      };
    }
  } catch {
    // Treat malformed legacy data as an entry without signup details.
  }

  return emptyDetails();
}

function emptyDetails(): StoredSignupDetails {
  return {
    roles: [],
    realm: "",
    characterName: "",
    keyIntent: null,
    dungeon: "",
    keyLevel: null
  };
}

function isStoredRoles(value: unknown): value is QueueEntryDto["roles"] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 3 &&
    new Set(value).size === value.length &&
    value.every((role) => role === "tank" || role === "healer" || role === "dps")
  );
}
