import type { Database } from "@repo/db";
import { errors } from "@elastic/elasticsearch";
import type { SearchClient } from "./search-client.js";

type State = {
  emailId: string;
  userId: string;
  namespace: string;
  revision: bigint;
};

export function createSearchIndex(
  database: Database,
  search: SearchClient,
  namespace?: string,
) {
  const { client, index } = search;
  async function reset() {
    await database.searchCheckpoint.deleteMany({
      where: { indexName: { startsWith: `${index}/` } },
    });
  }
  async function ensure() {
    if (await client.indices.exists({ index })) {
      if (
        !(await client.indices.existsAlias({ index, name: `${index}-write` }))
      )
        await client.indices.putAlias({
          index,
          name: `${index}-write`,
          is_write_index: true,
        });
      return;
    }
    try {
      await client.indices.create({
        index,
        aliases: { [`${index}-write`]: { is_write_index: true } },
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: {
          dynamic: "strict",
          properties: {
            id: { type: "keyword" },
            userId: { type: "keyword" },
            namespace: { type: "keyword" },
            revision: { type: "long" },
            deleted: { type: "boolean" },
            batchId: { type: "keyword" },
            senderId: { type: "keyword" },
            status: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            recipient: { type: "text" },
            senderName: { type: "text" },
            senderEmail: { type: "text" },
            starred: { type: "boolean" },
            archived: { type: "boolean" },
            requestedAt: { type: "date" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            failedAt: { type: "date" },
          },
        },
      });
    } catch (error) {
      if (!(
        error instanceof errors.ResponseError &&
        error.body?.error?.type === "resource_already_exists_exception"
      ))
        throw error;
    }
  }
  async function sync() {
    await ensure();
    const settings = await client.indices.getSettings({
      index,
      name: "index.uuid",
    });
    const uuid = settings[index]?.settings?.index?.uuid;
    if (!uuid) throw new Error("Search index generation unavailable");
    const checkpoint = `${index}/${uuid}`;
    const snapshots = await database.$transaction(
      async (tx) => {
        const states = await tx.$queryRaw<State[]>`
        SELECT s.* FROM "SearchDocument" s
        LEFT JOIN "SearchCheckpoint" c ON c."emailId" = s."emailId" AND c."indexName" = ${checkpoint}
        WHERE (c.revision IS NULL OR c.revision < s.revision)
          AND (${namespace ?? null}::text IS NULL OR s.namespace = ${namespace ?? null})
        ORDER BY s.revision LIMIT 200`;
        const emails = await tx.email.findMany({
          where: { id: { in: states.map((s) => s.emailId) } },
          include: {
            batch: {
              include: { sender: { select: { name: true, email: true } } },
            },
          },
        });
        const byId = new Map(emails.map((email) => [email.id, email]));
        return states.map((state) => {
          const email = byId.get(state.emailId);
          const revision = Number(state.revision);
          if (!Number.isSafeInteger(revision))
            throw new Error("Search revision exceeds safe integer range");
          const source = {
            id: state.emailId,
            userId: state.userId,
            namespace: state.namespace,
            revision,
            deleted: !email || !!email.deletedAt,
          };
          return {
            state,
            source:
              !email || email.deletedAt
                ? source
                : {
                    ...source,
                    batchId: email.batchId,
                    senderId: email.batch.senderId,
                    status: email.status,
                    subject: email.batch.subject,
                    body: email.batch.body,
                    recipient: email.recipient,
                    senderName: email.batch.sender.name,
                    senderEmail: email.batch.sender.email,
                    starred: email.starred,
                    archived: email.archived,
                    requestedAt: email.requestedAt,
                    scheduledAt: email.scheduledAt,
                    sentAt: email.sentAt,
                    failedAt: email.failedAt,
                  },
          };
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
    if (!snapshots.length) return 0;
    const result = await client.bulk({
      require_alias: true,
      operations: snapshots.flatMap(({ state, source }) => [
        {
          index: {
            _index: `${index}-write`,
            _id: state.emailId,
            version: source.revision,
            version_type: "external_gte" as const,
          },
        },
        source,
      ]),
    });
    let failed = false;
    const accepted: State[] = [];
    for (const [position, item] of result.items.entries()) {
      const snapshot = snapshots[position]!;
      const status = item.index?.status;
      if (status !== undefined && (status < 300 || status === 409)) {
        accepted.push(snapshot.state);
      } else failed = true;
    }
    if (accepted.length)
      await database.$executeRaw`INSERT INTO "SearchCheckpoint" ("indexName", "emailId", revision)
      SELECT ${checkpoint}, changes.id, changes.revision
      FROM unnest(${accepted.map((s) => s.emailId)}::uuid[], ${accepted.map((s) => s.revision)}::bigint[]) AS changes(id, revision)
      ON CONFLICT ("indexName", "emailId") DO UPDATE SET revision = GREATEST("SearchCheckpoint".revision, EXCLUDED.revision)`;
    if (failed) throw new Error("Some search documents could not be indexed");
    return snapshots.length;
  }
  return { ensure, sync, reset };
}
