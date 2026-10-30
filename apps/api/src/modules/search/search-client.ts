import { Client } from "@elastic/elasticsearch";
import { readFileSync } from "node:fs";
import { ConfigurationError } from "../../config/environment.js";

export function createSearchClient(env: NodeJS.ProcessEnv = process.env) {
  const node = env.ELASTICSEARCH_NODE;
  const apiKey = env.ELASTICSEARCH_API_KEY;
  const index = env.ELASTICSEARCH_INDEX ?? "email-scheduler-v1";
  if (!node && !apiKey) return undefined;
  if (!node || !apiKey)
    throw new ConfigurationError([
      "ELASTICSEARCH_NODE",
      "ELASTICSEARCH_API_KEY",
    ]);
  if (!/^email-scheduler-[a-z0-9-]+$/.test(index))
    throw new ConfigurationError(["ELASTICSEARCH_INDEX"]);
  const url = new URL(node);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new ConfigurationError(["ELASTICSEARCH_NODE"]);
  return {
    client: new Client({
      node,
      auth: { apiKey },
      requestTimeout: 5000,
      maxRetries: 0,
      ...(env.ELASTICSEARCH_CA_CERT_PATH
        ? {
            tls: {
              ca: readFileSync(env.ELASTICSEARCH_CA_CERT_PATH),
              rejectUnauthorized: true,
            },
          }
        : {}),
    }),
    index,
  };
}
export type SearchClient = NonNullable<ReturnType<typeof createSearchClient>>;
