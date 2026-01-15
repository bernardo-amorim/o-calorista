/**
 * Database Migration Script
 *
 * Applies all pending migrations to the database.
 * Usage: bun run db:migrate
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const databaseUrl = Bun.env.DATABASE_URL;

  console.log("🔄 Running database migrations...");

  // Create a connection specifically for migrations
  // (migrations need a dedicated connection, not a pool)
  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Migrations completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

main();
