import type { Database, Prisma } from "@repo/db";
import type { EmailQuery, EmailSummary, EmailStatus } from "@repo/shared";
import { AppError } from "../../errors/app-error.js";
import { attachmentSelect } from "../attachments/attachments.service.js";

export const scheduledStatuses: EmailStatus[] = [
  "PENDING_DISPATCH",
  "SCHEDULED",
  "PROCESSING",
  "RETRYING",
];
export const sentStatuses: EmailStatus[] = [
  "SENT",
  "FAILED",
  "DELIVERY_UNCERTAIN",
];
export const publicSenderSelect = {
  id: true,
  name: true,
  email: true,
} as const;
export const publicBatchSelect = {
  subject: true,
  body: true,
  sender: { select: publicSenderSelect },
} as const;

export function emailSummary(
  email: {
    id: string;
    batchId: string;
    recipient: string;
    status: EmailStatus;
    requestedAt: Date;
    scheduledAt: Date;
    starred: boolean;
    archived: boolean;
    sentAt: Date | null;
    failedAt: Date | null;
  },
  batch: {
    subject: string;
    body: string;
    sender: { id: string; name: string; email: string };
  },
): EmailSummary {
  return {
    id: email.id,
    batchId: email.batchId,
    recipient: email.recipient,
    status: email.status,
    subject: batch.subject,
    sender: batch.sender,
    requestedAt: email.requestedAt.toISOString(),
    scheduledAt: email.scheduledAt.toISOString(),
    starred: email.starred,
    archived: email.archived,
    bodyPreview: batch.body.replace(/\s+/g, " ").trim().slice(0, 240),
    sentAt: email.sentAt?.toISOString() ?? null,
    failedAt: email.failedAt?.toISOString() ?? null,
  };
}

export function createEmailQueries(database: Database) {
  return {
    async list(userId: string, query: EmailQuery, matchingIds?: string[]) {
      const base: Prisma.EmailWhereInput = {
        ...(matchingIds ? { id: { in: matchingIds } } : {}),
        deletedAt: null,
        batch: {
          userId,
          ...(query.senderId ? { senderId: query.senderId } : {}),
        },
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(query.view === "inbox"
          ? { archived: false }
          : query.view === "archived"
            ? { archived: true }
            : query.view === "starred"
              ? { starred: true }
              : {}),
      };
      const statuses =
        query.mailbox === "scheduled"
          ? scheduledStatuses
          : query.mailbox === "sent"
            ? sentStatuses
            : undefined;
      const where: Prisma.EmailWhereInput = {
        AND: [
          base,
          ...(statuses ? [{ status: { in: statuses } }] : []),
          ...(query.status ? [{ status: query.status }] : []),
        ],
      };
      const [total, scheduled, sent, emails] = await database.$transaction(
        [
          database.email.count({ where }),
          database.email.count({
            where: { AND: [base, { status: { in: scheduledStatuses } }] },
          }),
          database.email.count({
            where: { AND: [base, { status: { in: sentStatuses } }] },
          }),
          database.email.findMany({
            where,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            orderBy:
              query.mailbox === "sent"
                ? [{ createdAt: "desc" }, { id: "desc" }]
                : [{ scheduledAt: "asc" }, { id: "asc" }],
            include: { batch: { select: publicBatchSelect } },
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return {
        items: emails.map((email) => emailSummary(email, email.batch)),
        counts: { scheduled, sent },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
    async detail(userId: string, id: string) {
      const email = await database.email.findFirst({
        where: { id, deletedAt: null, batch: { userId } },
        include: {
          batch: {
            select: {
              ...publicBatchSelect,
              bodyHtml: true,
              attachments: {
                select: attachmentSelect,
                orderBy: { createdAt: "asc" },
              },
              delayMs: true,
              hourlyLimit: true,
            },
          },
          attempts: { orderBy: { number: "asc" } },
        },
      });
      if (!email)
        throw new AppError(404, "EMAIL_NOT_FOUND", "Email not found.");
      return {
        ...emailSummary(email, email.batch),
        body: email.batch.body,
        bodyHtml: email.batch.bodyHtml,
        attachments: email.batch.attachments,
        createdAt: email.createdAt.toISOString(),
        delayMs: email.batch.delayMs,
        hourlyLimit: email.batch.hourlyLimit,
        attemptsMade: email.attemptsMade,
        lastErrorCode: email.lastErrorCode,
        deferredReason: email.deferredReason,
        messageId: email.messageId,
        previewUrl: email.previewUrl,
        attempts: email.attempts.map((attempt) => ({
          id: attempt.id,
          number: attempt.number,
          outcome: attempt.outcome,
          reservedAt: attempt.reservedAt.toISOString(),
          startedAt: attempt.startedAt?.toISOString() ?? null,
          finishedAt: attempt.finishedAt?.toISOString() ?? null,
          errorCode: attempt.errorCode,
          smtpResponseCode: attempt.smtpResponseCode,
        })),
      };
    },
  };
}
