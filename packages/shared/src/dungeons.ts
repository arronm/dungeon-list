// Midnight Season 1 Mythic+ rotation published by Blizzard on 2026-03-18.
export const mythicPlusDungeons = [
  "Magisters' Terrace",
  "Maisara Caverns",
  "Nexus-Point Xenas",
  "Windrunner Spire",
  "Algeth'ar Academy",
  "Pit of Saron",
  "Seat of the Triumvirate",
  "Skyreach"
] as const;

export const anyMythicPlusDungeon = "Any" as const;

export type MythicPlusDungeon = (typeof mythicPlusDungeons)[number];
export type KeyRequestDungeon = MythicPlusDungeon | typeof anyMythicPlusDungeon;

export const mythicPlusDungeonShortNames: Record<MythicPlusDungeon, string> = {
  "Magisters' Terrace": "MT",
  "Maisara Caverns": "Cavern",
  "Nexus-Point Xenas": "Xenas",
  "Windrunner Spire": "Spire",
  "Algeth'ar Academy": "AA",
  "Pit of Saron": "Pit",
  "Seat of the Triumvirate": "Seat",
  Skyreach: "Sky"
};

export function getMythicPlusDungeonShortName(dungeon: string): string {
  return mythicPlusDungeonShortNames[dungeon as MythicPlusDungeon] ?? dungeon;
}
