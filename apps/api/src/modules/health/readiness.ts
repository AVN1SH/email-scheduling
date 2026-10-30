import type { ReadinessResponse } from "@repo/shared";

export type ReadinessChecks = {
  database: () => Promise<void>;
  redis: () => Promise<void>;
};

async function checkDependency(check: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Dependency check timed out")),
          timeoutMs,
        );
      }),
    ]);
    return "up" as const;
  } catch {
    return "down" as const;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(
  checks: ReadinessChecks,
  timeoutMs = 3_000,
): Promise<ReadinessResponse> {
  const [database, redis] = await Promise.all([
    checkDependency(checks.database, timeoutMs),
    checkDependency(checks.redis, timeoutMs),
  ]);
  return {
    status: database === "up" && redis === "up" ? "ready" : "not_ready",
    services: { database, redis },
  };
}
