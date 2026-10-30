import { Router } from "express";
import { z } from "zod";
import {
  emailQuerySchema,
  scheduleRequestSchema,
  emailUpdateSchema,
} from "@repo/shared";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Logger } from "pino";
import { AppError } from "../../errors/app-error.js";
import type { AuthRouterOptions } from "../auth/auth.router.js";
import type { AuthRepository } from "../auth/auth.repository.js";
import {
  currentUser,
  requireAdmin,
  requireCsrf,
  requireJsonOrigin,
  requireUser,
} from "../auth/security.js";
import type { SendersService } from "../senders/senders.service.js";
import type { SchedulingService } from "./scheduling.service.js";
import type { Queues } from "../../queues/queues.js";
import type { EmailActions } from "../emails/email-actions.service.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { SchedulingEnvironment } from "../../config/scheduling-environment.js";
import { createComposeRouter } from "../compose/compose.router.js";
import type { SearchService } from "../search/search.service.js";

export type SchedulingRouterOptions = {
  search?: SearchService;
  senders: SendersService;
  scheduling: SchedulingService;
  queues: Queues;
  repository: AuthRepository;
  adminEmails: string[];
  logger: Logger;
  actions: EmailActions;
  attachments: AttachmentsService;
  settings: SchedulingEnvironment;
};

export function createSchedulingRouter(
  auth: AuthRouterOptions,
  options: SchedulingRouterOptions,
) {
  const router = Router();
  router.use(createComposeRouter(auth, options.attachments, options.settings));
  const protectedRoutes = Router();
  protectedRoutes.use(
    requireUser(auth.service),
    requireJsonOrigin(auth.environment.APP_URL),
    requireCsrf,
  );
  protectedRoutes.get("/senders", async (_request, response) =>
    response.json(await options.senders.list(currentUser(response).id)),
  );
  protectedRoutes.post("/emails/schedule", async (request, response) => {
    const key = z
      .string()
      .min(8)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .safeParse(request.get("idempotency-key"));
    const parsed = scheduleRequestSchema.safeParse(request.body);
    if (!key.success)
      throw new AppError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header containing 8–128 letters, numbers, underscores, or hyphens.",
      );
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_SCHEDULE",
        "Check the sender, recipients, subject, body, start time, delay, and hourly limit.",
      );
    const result = await options.scheduling.schedule(
      currentUser(response).id,
      key.data,
      parsed.data,
    );
    void options.queues
      .enqueueBatch(result.batch.id)
      .catch(() =>
        options.logger.warn(
          { batchId: result.batch.id },
          "Schedule saved; worker recovery will publish its jobs",
        ),
      );
    response.status(result.replayed ? 200 : 201).json(result);
  });
  protectedRoutes.get("/emails", async (request, response) => {
    const parsed = emailQuerySchema.safeParse(request.query);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_QUERY",
        "Check the page, page size, batch, and status filters.",
      );
    if (parsed.data.q && !options.search)
      throw new AppError(
        503,
        "SEARCH_UNAVAILABLE",
        "Search is temporarily unavailable. Clear your search to browse emails.",
      );
    response.json(
      await (parsed.data.q ? options.search! : options.scheduling).list(
        currentUser(response).id,
        parsed.data,
      ),
    );
  });
  protectedRoutes.get("/emails/:id", async (request, response) => {
    const parsed = z.uuid().safeParse(request.params.id);
    if (!parsed.success)
      throw new AppError(400, "INVALID_ID", "Use a valid email ID.");
    response.json(
      await options.scheduling.detail(currentUser(response).id, parsed.data),
    );
  });
  protectedRoutes.patch("/emails/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id),
      input = emailUpdateSchema.safeParse(request.body);
    if (!id.success || !input.success)
      throw new AppError(
        400,
        "INVALID_EMAIL_UPDATE",
        "Use a valid email ID and a starred or archived boolean.",
      );
    response.json(
      await options.actions.update(
        currentUser(response).id,
        id.data,
        input.data,
      ),
    );
  });
  protectedRoutes.delete("/emails/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success)
      throw new AppError(400, "INVALID_ID", "Use a valid email ID.");
    await options.actions.remove(currentUser(response).id, id.data);
    response.status(204).end();
  });

  const board = new ExpressAdapter();
  board.setBasePath("/api/admin/queues");
  createBullBoard({
    queues: [
      new BullMQAdapter(options.queues.send, { readOnlyMode: true }),
      new BullMQAdapter(options.queues.dispatch, { readOnlyMode: true }),
    ],
    serverAdapter: board,
  });
  router.use(
    "/admin/queues",
    requireAdmin(options.repository, options.adminEmails),
    (request, _response, next) => {
      if (!["GET", "HEAD"].includes(request.method))
        throw new AppError(
          405,
          "METHOD_NOT_ALLOWED",
          "This queue dashboard is read-only.",
        );
      next();
    },
    board.getRouter(),
  );
  router.use(protectedRoutes);
  return router;
}
