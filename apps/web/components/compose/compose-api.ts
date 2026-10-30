import {
  attachmentSchema,
  leadImportResponseSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_LEAD_FILE_BYTES,
} from "@repo/shared";
import { mailRequest } from "../mailbox/mail-api";

export function jsonMutation(body: unknown, csrfToken: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  };
}
export async function uploadAttachment(file: File, csrfToken: string) {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
    throw new Error("Choose a nonempty attachment up to 5 MB.");
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.readAsDataURL(file);
  });
  return mailRequest(
    "/attachments",
    attachmentSchema,
    jsonMutation({ filename: file.name, contentBase64 }, csrfToken),
  );
}
export function removeAttachment(id: string, csrfToken: string) {
  return mailRequest(
    `/attachments/${id}`,
    { parse: () => undefined },
    { ...jsonMutation({}, csrfToken), method: "DELETE" },
  );
}
export async function importLeadFile(file: File, csrfToken: string) {
  if (
    !/\.(csv|txt)$/i.test(file.name) ||
    file.size > MAX_LEAD_FILE_BYTES ||
    !file.size
  )
    throw new Error("Choose a nonempty UTF-8 CSV/text file up to 1 MB.");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(
    await file.arrayBuffer(),
  );
  return mailRequest(
    "/leads/parse",
    leadImportResponseSchema,
    jsonMutation({ filename: file.name, content }, csrfToken),
  );
}
