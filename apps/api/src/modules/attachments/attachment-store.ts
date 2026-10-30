import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MAX_ATTACHMENT_BYTES } from "@repo/shared";

const root = new URL("../../../var/uploads/", import.meta.url);
function path(id: string) {
  return fileURLToPath(new URL(z.uuid().parse(id), root));
}
export function checksum(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}
export const attachmentStore = {
  async write(id: string, content: Buffer) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path(id), content, { flag: "wx", mode: 0o600 });
  },
  async read(file: { id: string; size: number; sha256: string }) {
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw new Error("Attachment size exceeds limit");
    const content = await readFile(path(file.id));
    if (content.length !== file.size || checksum(content) !== file.sha256)
      throw new Error("Attachment integrity check failed");
    return content;
  },
  async remove(id: string) {
    await unlink(path(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
};
