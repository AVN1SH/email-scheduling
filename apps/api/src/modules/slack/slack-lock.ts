import type { Prisma } from "@repo/db";

export async function lockSlackUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$executeRaw`SET LOCAL statement_timeout = '9000ms'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`slack:${userId}`}, 0))`;
}
