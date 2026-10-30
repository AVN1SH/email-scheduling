import { randomUUID } from "node:crypto";
import type { Database, Prisma } from "@repo/db";
import { fileTypeFromBuffer } from "file-type";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type Attachment,
} from "@repo/shared";
import { AppError } from "../../errors/app-error.js";
import { attachmentStore, checksum } from "./attachment-store.js";

export const attachmentSelect = {
  id: true,
  filename: true,
  contentType: true,
  size: true,
} as const;
export const previewTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function createAttachmentsService(database: Database) {
  return {
    async upload(
      userId: string,
      input: { filename: string; contentBase64: string },
    ): Promise<Attachment> {
      const content = Buffer.from(input.contentBase64, "base64");
      if (
        !content.length ||
        content.length > MAX_ATTACHMENT_BYTES ||
        content.toString("base64") !== input.contentBase64
      )
        throw new AppError(
          400,
          "INVALID_ATTACHMENT",
          "Use a nonempty file up to 5 MB with valid content.",
        );
      const detected = await fileTypeFromBuffer(content).catch(() => undefined);
      const id = randomUUID();
      await attachmentStore.write(id, content);
      try {
        return await database.attachment.create({
          data: {
            id,
            userId,
            filename: input.filename,
            size: content.length,
            contentType: detected?.mime ?? "application/octet-stream",
            sha256: checksum(content),
          },
          select: attachmentSelect,
        });
      } catch (error) {
        await attachmentStore.remove(id);
        throw error;
      }
    },
    async read(userId: string, id: string) {
      const file = await database.attachment.findFirst({
        where: {
          id,
          userId,
          OR: [
            { batchId: null },
            { batch: { emails: { some: { deletedAt: null } } } },
          ],
        },
      });
      if (!file)
        throw new AppError(
          404,
          "ATTACHMENT_NOT_FOUND",
          "Attachment not found.",
        );
      try {
        return { file, content: await attachmentStore.read(file) };
      } catch {
        throw new AppError(
          503,
          "ATTACHMENT_UNAVAILABLE",
          "The attachment file is unavailable. Check the local storage.",
        );
      }
    },
    async remove(userId: string, id: string) {
      const result = await database.attachment.deleteMany({
        where: { id, userId, batchId: null },
      });
      if (!result.count) {
        const file = await database.attachment.findFirst({
          where: { id, userId },
        });
        if (file)
          throw new AppError(
            409,
            "ATTACHMENT_IN_USE",
            "A scheduled attachment cannot be removed.",
          );
        throw new AppError(
          404,
          "ATTACHMENT_NOT_FOUND",
          "Attachment not found.",
        );
      }
      await attachmentStore.remove(id);
    },
  };
}

export async function claimAttachments(
  tx: Prisma.TransactionClient,
  userId: string,
  batchId: string,
  ids: string[],
) {
  if (!ids.length) return;
  const files = await tx.attachment.findMany({
    where: { id: { in: ids }, userId, batchId: null },
  });
  if (files.length !== ids.length)
    throw new AppError(
      400,
      "INVALID_ATTACHMENTS",
      "Choose your own uploaded attachments that have not been scheduled.",
    );
  if (
    files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES
  )
    throw new AppError(
      400,
      "ATTACHMENTS_TOO_LARGE",
      "Keep total attachment size within 20 MB.",
    );
  try {
    await Promise.all(files.map((file) => attachmentStore.read(file)));
  } catch {
    throw new AppError(
      400,
      "ATTACHMENT_UNAVAILABLE",
      "Upload the missing attachment again before scheduling.",
    );
  }
  const claimed = await tx.attachment.updateMany({
    where: { id: { in: ids }, userId, batchId: null },
    data: { batchId },
  });
  if (claimed.count !== ids.length)
    throw new AppError(
      409,
      "ATTACHMENT_IN_USE",
      "An attachment was already scheduled or removed. Refresh and try again.",
    );
}
export type AttachmentsService = ReturnType<typeof createAttachmentsService>;
