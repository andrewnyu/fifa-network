import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running the people database migration.");
}

const schema = await readFile(
  new URL("../db/postgres-schema.sql", import.meta.url),
  "utf8",
);
const sql = neon(databaseUrl);
const statements = schema
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
await sql.transaction(statements.map((statement) => sql.query(statement)));
console.log("People profile tables are ready.");
