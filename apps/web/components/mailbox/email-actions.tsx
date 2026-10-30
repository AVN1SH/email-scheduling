"use client";

import type { EmailSummary, EmailUpdate } from "@repo/shared";
import { MailIcon } from "./icons";

export function EmailActions({
  email,
  pending,
  onUpdate,
  onDelete,
  compact = false,
}: {
  email: EmailSummary;
  pending: boolean;
  onUpdate: (update: EmailUpdate) => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`email-actions${compact ? " email-actions-compact" : ""}`}>
      <button
        className={`mail-icon-button${email.starred ? " is-starred" : ""}`}
        disabled={pending}
        aria-label={email.starred ? "Unstar email" : "Star email"}
        aria-pressed={email.starred}
        title={email.starred ? "Unstar" : "Star"}
        onClick={() => onUpdate({ starred: !email.starred })}
      >
        <MailIcon name="star" fill={email.starred ? "currentColor" : "none"} />
      </button>
      <button
        className="mail-icon-button secondary-row-action"
        disabled={pending}
        aria-label={email.archived ? "Unarchive email" : "Archive email"}
        title={email.archived ? "Unarchive" : "Archive"}
        onClick={() => onUpdate({ archived: !email.archived })}
      >
        <MailIcon name="archive" />
      </button>
      <button
        className="mail-icon-button secondary-row-action"
        disabled={pending}
        aria-label="Delete email"
        title="Delete"
        onClick={onDelete}
      >
        <MailIcon name="trash" />
      </button>
    </div>
  );
}
export function confirmEmailDeletion(email: EmailSummary) {
  return window.confirm(
    ["PENDING_DISPATCH", "SCHEDULED", "RETRYING", "PROCESSING"].includes(
      email.status,
    )
      ? "Delete this email? Scheduled delivery will be cancelled if sending has not started."
      : "Delete this email from your mailbox?",
  );
}
