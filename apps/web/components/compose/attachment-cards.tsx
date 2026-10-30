"use client";

import Image from "next/image";
import type { Attachment } from "@repo/shared";
import { MailIcon } from "../mailbox/icons";

export function attachmentSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function AttachmentCards({
  files,
  onRemove,
  disabled = false,
}: {
  files: Attachment[];
  onRemove?: (file: Attachment) => void;
  disabled?: boolean;
}) {
  if (!files.length) return null;
  return (
    <div className="attachment-cards" aria-label="Attachments">
      {files.map((file) => {
        const image = [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ].includes(file.contentType);
        return (
          <div className="attachment-card" key={file.id}>
            <a
              href={`/api/attachments/${file.id}${image ? "?preview=1" : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${file.filename}`}
            >
              {image ? (
                <Image
                  src={`/api/attachments/${file.id}?preview=1`}
                  alt={file.filename}
                  width={160}
                  height={95}
                  unoptimized
                  className="attachment-image"
                />
              ) : (
                <span className="attachment-file-icon">
                  <MailIcon name="attachment" width={28} height={28} />
                </span>
              )}
            </a>
            <div className="attachment-caption">
              <a
                href={`/api/attachments/${file.id}`}
                title={`Download ${file.filename}`}
              >
                {file.filename}
              </a>
              <small>{attachmentSize(file.size)}</small>
            </div>
            {onRemove && (
              <button
                type="button"
                className="attachment-remove mail-icon-button"
                aria-label={`Remove ${file.filename}`}
                disabled={disabled}
                onClick={() => onRemove(file)}
              >
                <MailIcon name="close" width={13} height={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
