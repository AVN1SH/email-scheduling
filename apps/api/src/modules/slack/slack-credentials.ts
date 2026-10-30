import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export const webhookSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "hooks.slack.com" &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
  );
});
export function encryptWebhook(
  webhook: string,
  encodedKey: string,
  userId: string,
  generation: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(encodedKey, "base64"),
    iv,
  );
  cipher.setAAD(Buffer.from(`slack:v1:${userId}:${generation}`));
  const encrypted = Buffer.concat([
    cipher.update(webhookSchema.parse(webhook), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptWebhook(
  value: string,
  encodedKey: string,
  userId: string,
  generation: string,
) {
  try {
    const [version, iv, tag, encrypted, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted || extra)
      throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(encodedKey, "base64"),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`slack:v1:${userId}:${generation}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return webhookSchema.parse(
      Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error(
      "Stored Slack credentials are unavailable. Reconnect Slack or check the stable encryption key.",
    );
  }
}
