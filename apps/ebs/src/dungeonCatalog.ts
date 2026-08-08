import {
  dungeonCatalogSchema,
  isDungeonInCatalog,
  type DungeonCatalogDto
} from "@dungeon-list/shared";
import { ApiError } from "./errors.js";

// Midnight Season 1 Mythic+ rotation published by Blizzard on 2026-03-18.
// Update this catalog and deploy only the EBS when the seasonal rotation changes.
export const currentDungeonCatalog: DungeonCatalogDto = dungeonCatalogSchema.parse({
  seasonId: "midnight-season-1",
  seasonName: "Midnight Season 1",
  dungeons: [
    { name: "Magisters' Terrace", shortName: "MT" },
    { name: "Maisara Caverns", shortName: "Cavern" },
    { name: "Nexus-Point Xenas", shortName: "Xenas" },
    { name: "Windrunner Spire", shortName: "Spire" },
    { name: "Algeth'ar Academy", shortName: "AA" },
    { name: "Pit of Saron", shortName: "Pit" },
    { name: "Seat of the Triumvirate", shortName: "Seat" },
    { name: "Skyreach", shortName: "Sky" }
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
