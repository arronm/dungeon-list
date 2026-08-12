import {
  dungeonCatalogSchema,
  isDungeonInCatalog,
  type DungeonCatalogDto
} from "@dungeon-list/shared";
import { ApiError } from "./errors.js";

// Midnight Season 2 Mythic+ rotation.
// Update this catalog and deploy only the EBS when the seasonal rotation changes.
export const currentDungeonCatalog: DungeonCatalogDto = dungeonCatalogSchema.parse({
  seasonId: "midnight-season-2",
  seasonName: "Midnight Season 2",
  dungeons: [
    { name: "Altar of Fangs", shortName: "ALTAR" },
    { name: "Den of Nalorakk", shortName: "DEN" },
    { name: "Murder Row", shortName: "MURDER" },
    { name: "The Blinding Vale", shortName: "VALE" },
    { name: "Voidscar Arena", shortName: "ARENA" },
    { name: "King's Rest", shortName: "REST" },
    { name: "Temple of Sethraliss", shortName: "TEMPLE" },
    { name: "Ruby Life Pools", shortName: "POOLS" }
  ]
});

export function requireCurrentDungeon(dungeon: string, allowAny: boolean): void {
  if (isDungeonInCatalog(dungeon, currentDungeonCatalog, allowAny)) {
    return;
  }

  throw new ApiError(
    400,
    "unsupported_dungeon",
    `Select a dungeon from ${currentDungeonCatalog.seasonName}. Refresh the extension if the season recently changed.`
  );
}
