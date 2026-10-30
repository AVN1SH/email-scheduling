import type { Logger } from "pino";

export function installShutdown(
  logger: Logger,
  close: () => Promise<void>,
  timeoutMs = 10000,
) {
  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Stopping process");
    const timer = setTimeout(() => {
      logger.error("Shutdown timed out");
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    try {
      await close();
      logger.info("Process stopped");
    } catch {
      logger.error("Shutdown failed");
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
