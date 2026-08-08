import { z } from "zod";

export const anyMythicPlusDungeon = "Any" as const;

export const dungeonNameSchema = z
  .string()
  .trim()
  .min(1, "Select a dungeon.")
  .max(80, "Dungeon names must be 80 characters or fewer.");

export const specificDungeonNameSchema = dungeonNameSchema.refine(
  (dungeon) => dungeon !== anyMythicPlusDungeon,
  "Select a specific dungeon."
);

export const dungeonOptionSchema = z.object({
  name: specificDungeonNameSchema,
  shortName: z
    .string()
    .trim()
    .min(1, "Dungeon short names cannot be empty.")
    .max(20, "Dungeon short names must be 20 characters or fewer.")
});

export const dungeonCatalogSchema = z
  .object({
    seasonId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Season IDs must use lowercase kebab-case."),
    seasonName: z.string().trim().min(1).max(80),
    dungeons: z.array(dungeonOptionSchema).min(1).max(20)
  })
  .superRefine((catalog, context) => {
    const names = new Set<string>();
    for (const [index, dungeon] of catalog.dungeons.entries()) {
      const normalizedName = dungeon.name.toLocaleLowerCase("en-US");
      if (names.has(normalizedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dungeons", index, "name"],
          message: "Dungeon names must be unique."
        });
      }
      names.add(normalizedName);
    }
  });

export type DungeonOptionDto = z.infer<typeof dungeonOptionSchema>;
export type DungeonCatalogDto = z.infer<typeof dungeonCatalogSchema>;
export type MythicPlusDungeon = string;
export type KeyRequestDungeon = MythicPlusDungeon | typeof anyMythicPlusDungeon;

export function isDungeonInCatalog(
  dungeon: string,
  catalog: Pick<DungeonCatalogDto, "dungeons">,
  allowAny = false
): boolean {
  if (allowAny && dungeon === anyMythicPlusDungeon) {
    return true;
  }

  return catalog.dungeons.some((candidate) => candidate.name === dungeon);
}

export function getMythicPlusDungeonShortName(
  dungeon: string,
  dungeons: readonly DungeonOptionDto[]
): string {
  return dungeons.find((candidate) => candidate.name === dungeon)?.shortName ?? dungeon;
}
