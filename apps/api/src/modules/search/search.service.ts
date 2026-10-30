import type { Database } from "@repo/db";
import type { EmailQuery } from "@repo/shared";
import type { estypes } from "@elastic/elasticsearch";
import { AppError } from "../../errors/app-error.js";
import { createEmailQueries } from "../emails/email-queries.js";
import type { SearchClient } from "./search-client.js";

export function createSearchService(database: Database, search?: SearchClient) {
  return {
    async list(userId: string, query: EmailQuery) {
      if (!search) throw unavailable();
      let pitId: string | undefined;
      try {
        pitId = (
          await search.client.openPointInTime({
            index: search.index,
            keep_alive: "1m",
          })
        ).id;
        const ids: string[] = [];
        let after: estypes.SortResults | undefined;
        for (;;) {
          const result: estypes.SearchResponse = await search.client.search({
            pit: { id: pitId!, keep_alive: "1m" },
            size: 500,
            _source: false,
            sort: [{ id: "asc" }],
            search_after: after,
            query: {
              bool: {
                filter: [{ term: { userId } }, { term: { deleted: false } }],
                must: [
                  {
                    multi_match: {
                      query: query.q!,
                      fields: [
                        "subject^3",
                        "body",
                        "recipient",
                        "senderName",
                        "senderEmail",
                      ],
                      type: "cross_fields",
                      operator: "and",
                    },
                  },
                ],
              },
            },
          });
          pitId = result.pit_id ?? pitId;
          if (result.timed_out || result._shards.failed) throw unavailable();
          const hits = result.hits.hits;
          ids.push(...hits.map((hit) => hit._id!));
          if (ids.length > 10000)
            throw new AppError(
              422,
              "SEARCH_TOO_BROAD",
              "More than 10,000 emails match. Use a more specific search.",
            );
          if (hits.length < 500) break;
          after = hits.at(-1)!.sort;
        }
        // PostgreSQL remains authoritative for ownership, visibility, status and counts.
        return await createEmailQueries(database).list(userId, query, ids);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw unavailable();
      } finally {
        if (pitId)
          await search.client.closePointInTime({ id: pitId }).catch(() => {});
      }
    },
  };
}
function unavailable() {
  return new AppError(
    503,
    "SEARCH_UNAVAILABLE",
    "Search is temporarily unavailable. Clear your search to browse emails, or try again shortly.",
  );
}
export type SearchService = ReturnType<typeof createSearchService>;
