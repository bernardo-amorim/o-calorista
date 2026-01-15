/**
 * Database connection and client
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Get DATABASE_URL from environment (typed in env.d.ts)
const databaseUrl = Bun.env.DATABASE_URL;

// Create postgres connection
// For query purposes (uses connection pooling)
const queryClient = postgres(databaseUrl);

// Create drizzle instance with schema
export const db = drizzle(queryClient, { schema });

// Export schema for convenience
export * from "./schema";

// Export a function to close the connection (useful for scripts)
export async function closeConnection() {
  await queryClient.end();
}
