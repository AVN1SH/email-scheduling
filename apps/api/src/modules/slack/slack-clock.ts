import type { Prisma } from "@repo/db";

export async function slackTime(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const [row] = await database.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return row!.now;
}
