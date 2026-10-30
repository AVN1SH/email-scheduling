import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_LEAD_FILE_BYTES = 1024 * 1024;
export const MAX_RECIPIENTS = 5000;
export const recipientAddressSchema = z.email().max(254);

export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().positive(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const attachmentUploadSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (value) =>
          !value.includes("/") &&
          !value.includes("\\") &&
          [...value].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
      ),
    contentBase64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
      .refine(
        (value) =>
          value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
      ),
  })
  .strict();
export const leadImportSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(180)
      .regex(/\.(csv|txt)$/i),
    content: z.string().min(1).max(MAX_LEAD_FILE_BYTES),
  })
  .strict();
export const leadImportResponseSchema = z.object({
  recipients: z.array(z.email()).max(MAX_RECIPIENTS),
  invalid: z.array(z.string()),
  invalidCount: z.number().int(),
  duplicateCount: z.number().int(),
  detectedCount: z.number().int(),
});
export type LeadImportResult = z.infer<typeof leadImportResponseSchema>;
export const composeOptionsSchema = z.object({
  minDelayMs: z.number(),
  maxHourlyLimit: z.number(),
});
