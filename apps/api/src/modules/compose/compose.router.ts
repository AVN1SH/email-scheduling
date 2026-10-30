import { Router } from "express";
import { z } from "zod";
import { attachmentUploadSchema, leadImportSchema } from "@repo/shared";
import { AppError } from "../../errors/app-error.js";
import type { AuthRouterOptions } from "../auth/auth.router.js";
import {
  currentUser,
  requireCsrf,
  requireJsonOrigin,
  requireUser,
} from "../auth/security.js";
import {
  previewTypes,
  type AttachmentsService,
} from "../attachments/attachments.service.js";
import type { SchedulingEnvironment } from "../../config/scheduling-environment.js";
import { parseLeads } from "./lead-import.js";

export function createComposeRouter(
  auth: AuthRouterOptions,
  attachments: AttachmentsService,
  settings: SchedulingEnvironment,
) {
  const router = Router();
  router.use(
    ["/compose/options", "/leads/parse", "/attachments"],
    requireUser(auth.service),
    requireJsonOrigin(auth.environment.APP_URL),
    requireCsrf,
  );
  router.get("/compose/options", (_request, response) =>
    response.json({
      minDelayMs: settings.MIN_EMAIL_DELAY_MS,
      maxHourlyLimit: settings.MAX_EMAILS_PER_HOUR_PER_SENDER,
    }),
  );
  router.post("/leads/parse", (request, response) => {
    const parsed = leadImportSchema.safeParse(request.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_LEAD_FILE",
        "Choose a CSV/text file up to 1 MB.",
      );
    response.json(parseLeads(parsed.data.filename, parsed.data.content));
  });
  router.post("/attachments", async (request, response) => {
    const parsed = attachmentUploadSchema.safeParse(request.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_ATTACHMENT",
        "Choose a file up to 5 MB with a valid filename.",
      );
    response
      .status(201)
      .json(await attachments.upload(currentUser(response).id, parsed.data));
  });
  router.get("/attachments/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success)
      throw new AppError(400, "INVALID_ID", "Use a valid attachment ID.");
    const { file, content } = await attachments.read(
      currentUser(response).id,
      id.data,
    );
    response.set("Cache-Control", "private, no-store");
    response.set("X-Content-Type-Options", "nosniff");
    response.set("Content-Security-Policy", "default-src 'none'; sandbox");
    response.attachment(file.filename);
    if (request.query.preview === "1" && previewTypes.has(file.contentType))
      response.set("Content-Disposition", "inline");
    response.type(file.contentType).send(content);
  });
  router.delete("/attachments/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success)
      throw new AppError(400, "INVALID_ID", "Use a valid attachment ID.");
    await attachments.remove(currentUser(response).id, id.data);
    response.status(204).end();
  });
  return router;
}
