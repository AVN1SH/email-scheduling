import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { senderImportSchema, type SenderImport } from "@repo/shared";

export function senderIdentity(
  sender: Pick<SenderImport, "smtpHost" | "smtpUser">,
) {
  return createHash("sha256")
    .update(
      `${sender.smtpHost.toLowerCase()}\n${sender.smtpUser.toLowerCase()}`,
    )
    .digest("hex");
}

export function encryptCredentials(
  sender: SenderImport,
  encodedKey: string,
  ownerId: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(encodedKey, "base64"),
    iv,
  );
  cipher.setAAD(Buffer.from(`smtp:v1:${ownerId}:${senderIdentity(sender)}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(sender), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCredentials(
  value: string,
  encodedKey: string,
  ownerId: string,
  identity: string,
): SenderImport {
  try {
    const [version, iv, tag, encrypted, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted || extra)
      throw new Error("Invalid credential format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(encodedKey, "base64"),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`smtp:v1:${ownerId}:${identity}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]);
    return senderImportSchema.parse(JSON.parse(plain.toString("utf8")));
  } catch {
    throw new Error(
      "Stored SMTP credentials could not be decrypted. Check the stable encryption key and sender configuration.",
    );
  }
}
