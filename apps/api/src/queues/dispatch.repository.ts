import type { Database } from "@repo/db";
import { recoverableStatuses } from "../modules/delivery/delivery.repository.js";

export function createDispatchRepository(
  database: Database,
  namespace: string,
) {
  return {
    emails: (batchId: string) =>
      database.email.findMany({
        where: {
          batchId,
          deletedAt: null,
          batch: { namespace },
          status: { in: [...recoverableStatuses] },
        },
        select: { id: true, scheduledAt: true },
      }),
    async acknowledge(batchId: string) {
      await database.$transaction([
        database.email.updateMany({
          where: { batchId, deletedAt: null, status: "PENDING_DISPATCH" },
          data: { status: "SCHEDULED" },
        }),
        database.dispatchEvent.updateMany({
          where: { batchId, publishedAt: null },
          data: { publishedAt: new Date() },
        }),
      ]);
    },
    recoverableBatches: (cursor?: string) =>
      database.emailBatch.findMany({
        where: {
          namespace,
          emails: {
            some: { deletedAt: null, status: { in: [...recoverableStatuses] } },
          },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
        select: { id: true },
      }),
  };
}
export type DispatchRepository = ReturnType<typeof createDispatchRepository>;
