import type { JoinQueueRequest, QueueEntryDto } from "@dungeon-list/shared";

const characterDetailsPrefix = "character:v1:";

export function serializeCharacterDetails(input: JoinQueueRequest): string {
  return `${characterDetailsPrefix}${JSON.stringify([input.realm, input.characterName])}`;
}

export function parseCharacterDetails(value: string): Pick<QueueEntryDto, "realm" | "characterName"> {
  if (!value.startsWith(characterDetailsPrefix)) {
    return { realm: "", characterName: "" };
  }

  try {
    const parsed: unknown = JSON.parse(value.slice(characterDetailsPrefix.length));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { realm: parsed[0], characterName: parsed[1] };
    }
  } catch {
    // Treat malformed legacy data as an entry without character details.
  }

  return { realm: "", characterName: "" };
}
