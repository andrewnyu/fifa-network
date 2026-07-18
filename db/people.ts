import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type PublicPerson = {
  id: string;
  slug: string;
  displayName: string;
  playerIds: number[];
  updatedAt: string;
};

export type PersonRow = {
  id: string;
  slug: string;
  display_name: string;
  player_ids: Array<number | string> | null;
  updated_at: string | Date;
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getPeopleSql(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DatabaseNotConfiguredError();
  return neon(databaseUrl);
}

export function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSearchName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validatePlayerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const playerIds = Array.from(
    new Set(
      value.filter(
        (playerId): playerId is number =>
          typeof playerId === "number" &&
          Number.isSafeInteger(playerId) &&
          playerId > 0,
      ),
    ),
  );
  return playerIds.length > 0 && playerIds.length <= 12 ? playerIds : null;
}

export function publicPerson(row: PersonRow): PublicPerson {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    playerIds: (row.player_ids ?? []).map(Number),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function hashEditToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function makeSlug(displayName: string) {
  const base = normalizeSearchName(displayName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "player-link";
  return `${base}-${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`;
}
