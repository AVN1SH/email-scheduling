import { z } from "zod";
import { attachmentSchema, MAX_ATTACHMENTS } from "./compose.js";

export const senderImportSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    smtpHost: z.literal("smtp.ethereal.email"),
    smtpPort: z.union([z.literal(25), z.literal(465), z.literal(587)]),
    smtpSecure: z.boolean(),
    smtpUser: z.string().trim().min(1).max(254),
    smtpPassword: z.string().min(1).max(1024),
  })
  .strict()
  .refine((value) => value.smtpSecure === (value.smtpPort === 465), {
    message:
      "Port 465 requires secure=true; other supported ports use STARTTLS.",
    path: ["smtpSecure"],
  });

export const safeSenderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  createdAt: z.iso.datetime(),
});
export const sendersResponseSchema = z.object({
  items: z.array(safeSenderSchema),
});
export const emailStatusSchema = z.enum([
  "PENDING_DISPATCH",
  "SCHEDULED",
  "PROCESSING",
  "RETRYING",
  "SENT",
  "FAILED",
  "DELIVERY_UNCERTAIN",
  "CANCELLED",
]);
export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const scheduleRequestSchema = z
  .object({
    senderId: z.uuid(),
    recipients: z.array(z.string().max(320)).min(1).max(5000),
    subject: z.string().trim().min(1).max(998),
    body: z.string().min(1).max(100000),
    bodyHtml: z.string().min(1).max(200000).optional(),
    attachmentIds: z
      .array(z.uuid())
      .max(MAX_ATTACHMENTS)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    startAt: z.iso.datetime({ offset: true }),
    delayMs: z.number().int().min(0).max(86400000).optional(),
    hourlyLimit: z.number().int().min(1).optional(),
  })
  .strict();

export const emailQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    batchId: z.uuid().optional(),
    status: emailStatusSchema.optional(),
    mailbox: z.enum(["scheduled", "sent"]).optional(),
    view: z.enum(["inbox", "starred", "archived", "all"]).default("inbox"),
    senderId: z.uuid().optional(),
  })
  .strict();

export const emailSummarySchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  recipient: z.email(),
  subject: z.string(),
  status: emailStatusSchema,
  requestedAt: z.iso.datetime(),
  scheduledAt: z.iso.datetime(),
  starred: z.boolean(),
  archived: z.boolean(),
  bodyPreview: z.string(),
  sentAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  sender: z.object({ id: z.uuid(), name: z.string(), email: z.email() }),
});
export const emailDetailSchema = emailSummarySchema.extend({
  body: z.string(),
  bodyHtml: z.string().nullable(),
  attachments: z.array(attachmentSchema),
  createdAt: z.iso.datetime(),
  delayMs: z.number(),
  hourlyLimit: z.number(),
  attemptsMade: z.number(),
  sentAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  deferredReason: z.string().nullable(),
  messageId: z.string().nullable(),
  previewUrl: z.url().nullable(),
  attempts: z.array(
    z.object({
      id: z.uuid(),
      number: z.number(),
      outcome: z.enum([
        "RESERVED",
        "SMTP_STARTED",
        "SENT",
        "RETRYABLE_FAILURE",
        "PERMANENT_FAILURE",
        "UNCERTAIN",
        "ABANDONED",
      ]),
      reservedAt: z.iso.datetime(),
      startedAt: z.iso.datetime().nullable(),
      finishedAt: z.iso.datetime().nullable(),
      errorCode: z.string().nullable(),
      smtpResponseCode: z.number().nullable(),
    }),
  ),
});
export const scheduleResponseSchema = z.object({
  batch: z.object({
    id: z.uuid(),
    senderId: z.uuid(),
    subject: z.string(),
    body: z.string(),
    startAt: z.iso.datetime(),
    delayMs: z.number(),
    hourlyLimit: z.number(),
    recipientCount: z.number(),
    createdAt: z.iso.datetime(),
  }),
  emails: z.array(emailSummarySchema),
  duplicateRecipients: z.array(z.string()),
  replayed: z.boolean(),
  dispatchStatus: z.enum(["pending", "published"]),
});
export const emailsResponseSchema = z.object({
  items: z.array(emailSummarySchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
  counts: z.object({ scheduled: z.number(), sent: z.number() }),
});
export const emailUpdateSchema = z
  .object({ starred: z.boolean().optional(), archived: z.boolean().optional() })
  .strict()
  .refine(
    (value) => value.starred !== undefined || value.archived !== undefined,
  );
export type EmailUpdate = z.infer<typeof emailUpdateSchema>;
export type EmailSummary = z.infer<typeof emailSummarySchema>;
export type EmailDetail = z.infer<typeof emailDetailSchema>;
export type EmailsResponse = z.infer<typeof emailsResponseSchema>;
export type SenderImport = z.infer<typeof senderImportSchema>;
export type SafeSender = z.infer<typeof safeSenderSchema>;
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
export type EmailQuery = z.infer<typeof emailQuerySchema>;
