import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const environmentFile = fileURLToPath(
  new URL("../../apps/api/.env", import.meta.url),
);
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(process.env.DIRECT_URL
    ? {
        datasource: {
          url: process.env.DIRECT_URL,
          ...(process.env.SHADOW_DATABASE_URL
            ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
            : {}),
        },
      }
    : {}),
});
