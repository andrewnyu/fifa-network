import { NextResponse } from "next/server";
import {
  DatabaseNotConfiguredError,
  ensurePeopleSchema,
  getPeopleSql,
  hashEditToken,
  makeSlug,
  normalizeDisplayName,
  normalizeSearchName,
  publicPerson,
  validatePlayerIds,
  type PersonRow,
} from "@/db/people";

type ProfileBody = {
  id?: unknown;
  editToken?: unknown;
  displayName?: unknown;
  playerIds?: unknown;
};

function databaseError(error: unknown) {
  if (error instanceof DatabaseNotConfiguredError) {
    return NextResponse.json(
      {
        error: "Shared profiles need a database connection.",
        code: "database_not_configured",
      },
      { status: 503 },
    );
  }
  console.error("People API error", error);
  return NextResponse.json(
    { error: "The shared people graph is temporarily unavailable." },
    { status: 500 },
  );
}

function validateProfile(body: ProfileBody) {
  const displayName = normalizeDisplayName(body.displayName);
  const playerIds = validatePlayerIds(body.playerIds);
  if (displayName.length < 2 || displayName.length > 80) {
    return { error: "Use a name between 2 and 80 characters." } as const;
  }
  if (!playerIds) {
    return { error: "Choose between 1 and 12 player connections." } as const;
  }
  return { displayName, playerIds } as const;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug")?.trim();
    const query = normalizeSearchName(url.searchParams.get("q") ?? "");

    if (!slug && query.length < 2) {
      return NextResponse.json({ people: [] });
    }

    const sql = getPeopleSql();
    await ensurePeopleSchema(sql);

    const rows = slug
      ? await sql`
          SELECT p.id::text, p.slug, p.display_name,
            COALESCE(array_agg(l.player_id ORDER BY l.position)
              FILTER (WHERE l.player_id IS NOT NULL), '{}') AS player_ids,
            p.updated_at
          FROM people p
          LEFT JOIN person_player_links l ON l.person_id = p.id
          WHERE p.slug = ${slug}
          GROUP BY p.id
          LIMIT 1
        `
      : await sql`
          SELECT p.id::text, p.slug, p.display_name,
            COALESCE(array_agg(l.player_id ORDER BY l.position)
              FILTER (WHERE l.player_id IS NOT NULL), '{}') AS player_ids,
            p.updated_at
          FROM people p
          LEFT JOIN person_player_links l ON l.person_id = p.id
          WHERE p.normalized_name LIKE ${`%${query}%`}
          GROUP BY p.id
          ORDER BY
            CASE WHEN p.normalized_name LIKE ${`${query}%`} THEN 0 ELSE 1 END,
            p.updated_at DESC
          LIMIT 12
        `;

    return NextResponse.json({ people: rows.map((row) => publicPerson(row as PersonRow)) });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProfileBody;
    const profile = validateProfile(body);
    if ("error" in profile) {
      return NextResponse.json({ error: profile.error }, { status: 400 });
    }

    const sql = getPeopleSql();
    await ensurePeopleSchema(sql);
    const id = crypto.randomUUID();
    const slug = makeSlug(profile.displayName);
    const editToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const editTokenHash = await hashEditToken(editToken);
    const updatedAt = new Date().toISOString();

    await sql.transaction((transaction) => [
      transaction`
        INSERT INTO people (
          id, slug, display_name, normalized_name, edit_token_hash, created_at, updated_at
        ) VALUES (
          ${id}::uuid, ${slug}, ${profile.displayName},
          ${normalizeSearchName(profile.displayName)}, ${editTokenHash},
          ${updatedAt}::timestamptz, ${updatedAt}::timestamptz
        )
      `,
      ...profile.playerIds.map(
        (playerId, position) => transaction`
          INSERT INTO person_player_links (person_id, player_id, position)
          VALUES (${id}::uuid, ${playerId}, ${position})
        `,
      ),
    ]);

    return NextResponse.json(
      {
        person: {
          id,
          slug,
          displayName: profile.displayName,
          playerIds: profile.playerIds,
          updatedAt,
        },
        editToken,
      },
      { status: 201 },
    );
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as ProfileBody;
    const profile = validateProfile(body);
    if ("error" in profile) {
      return NextResponse.json({ error: profile.error }, { status: 400 });
    }
    if (
      typeof body.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id) ||
      typeof body.editToken !== "string" ||
      body.editToken.length < 64 ||
      body.editToken.length > 100
    ) {
      return NextResponse.json({ error: "Profile credentials are missing." }, { status: 401 });
    }

    const sql = getPeopleSql();
    await ensurePeopleSchema(sql);
    const editTokenHash = await hashEditToken(body.editToken);
    const [existing] = await sql`
      SELECT id::text FROM people
      WHERE id = ${body.id}::uuid AND edit_token_hash = ${editTokenHash}
      LIMIT 1
    `;
    if (!existing) {
      return NextResponse.json({ error: "This profile cannot be edited here." }, { status: 403 });
    }

    const updatedAt = new Date().toISOString();
    await sql.transaction((transaction) => [
      transaction`
        UPDATE people SET
          display_name = ${profile.displayName},
          normalized_name = ${normalizeSearchName(profile.displayName)},
          updated_at = ${updatedAt}::timestamptz
        WHERE id = ${body.id}::uuid
      `,
      transaction`DELETE FROM person_player_links WHERE person_id = ${body.id}::uuid`,
      ...profile.playerIds.map(
        (playerId, position) => transaction`
          INSERT INTO person_player_links (person_id, player_id, position)
          VALUES (${body.id}::uuid, ${playerId}, ${position})
        `,
      ),
    ]);

    const [row] = await sql`
      SELECT p.id::text, p.slug, p.display_name,
        COALESCE(array_agg(l.player_id ORDER BY l.position)
          FILTER (WHERE l.player_id IS NOT NULL), '{}') AS player_ids,
        p.updated_at
      FROM people p
      LEFT JOIN person_player_links l ON l.person_id = p.id
      WHERE p.id = ${body.id}::uuid
      GROUP BY p.id
    `;
    return NextResponse.json({ person: publicPerson(row as PersonRow) });
  } catch (error) {
    return databaseError(error);
  }
}
