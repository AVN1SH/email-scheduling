import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabase(connectionString: string) {
  const url = new URL(connectionString);
  // Keep Neon's current certificate verification explicit across pg upgrades.
  if (
    url.hostname.endsWith(".neon.tech") &&
    url.searchParams.get("sslmode") === "require"
  ) {
    url.searchParams.set("sslmode", "verify-full");
  }
  const adapter = new PrismaPg({
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 10_000,
  });

  return new PrismaClient({ adapter, log: [] });
}

export type Database = ReturnType<typeof createDatabase>;
export { Prisma } from "./generated/prisma/client.js";
