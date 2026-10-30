"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  emailDetailSchema,
  emailQuerySchema,
  type AuthResponse,
  type EmailUpdate,
} from "@repo/shared";
import { Avatar } from "../auth/account-menu";
import { MailIcon } from "./icons";
import { DeliveryBadge, LocalTime } from "./email-presentation";
import { useMailResource } from "./use-mail-resource";
import { EmailActions, confirmEmailDeletion } from "./email-actions";
import { updateEmail, deleteEmail } from "./mail-api";
import { AttachmentCards } from "../compose/attachment-cards";

export function EmailDetailView({
  id,
  session,
}: {
  id: string;
  session: AuthResponse;
}) {
  const resource = useMailResource(`/emails/${id}`, emailDetailSchema),
    router = useRouter(),
    search = useSearchParams();
  const from = search.get("from"),
    parsed = emailQuerySchema.safeParse(
      Object.fromEntries(new URLSearchParams(from ?? "")),
    );
  const backHref =
    from && parsed.success
      ? `/dashboard?${new URLSearchParams(from).toString()}`
      : "/dashboard";
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const email = resource.data;
  async function change(input?: EmailUpdate) {
    if (pending || !email) return;
    if (!input && !confirmEmailDeletion(email)) return;
    setPending(true);
    setError("");
    try {
      if (input) {
        const updated = await updateEmail(id, input, session.csrfToken);
        resource.setData(() => updated);
        resource.refresh();
      } else {
        await deleteEmail(id, session.csrfToken);
        router.replace(backHref);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update this email. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="email-detail">
      <header className="email-detail-header">
        <Link
          href={backHref}
          className="mail-icon-button"
          aria-label="Back to emails"
          title="Back to emails"
        >
          <MailIcon name="back" />
        </Link>
        <h1>{email?.subject ?? "Email"}</h1>
        {email && (
          <EmailActions
            email={email}
            pending={pending}
            onUpdate={(input) => void change(input)}
            onDelete={() => void change()}
          />
        )}
        <div
          className="email-detail-account"
          title={`${session.user.name ?? "Your account"} · ${session.user.email}`}
        >
          <Avatar user={session.user} />
        </div>
      </header>
      {(error || resource.error) && (
        <div className="mail-alert" role="alert">
          {error || resource.error}
          <button
            className="mail-text-button"
            onClick={() => {
              setError("");
              resource.refresh();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!email ? (
        <div className="mail-empty" role="status">
          {resource.error ? (
            <Link href={backHref} className="mail-text-button">
              Back to emails
            </Link>
          ) : (
            "Loading email…"
          )}
        </div>
      ) : (
        <article className="email-detail-content">
          <div className="email-sender-heading">
            <span className="email-sender-avatar" aria-hidden="true">
              {email.sender.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="email-sender-identity">
              <div>
                <strong>{email.sender.name}</strong>{" "}
                <span className="email-sender-address">
                  &lt;{email.sender.email}&gt;
                </span>
              </div>
              <details className="email-envelope">
                <summary>to {email.recipient}</summary>
                <dl>
                  <dt>From</dt>
                  <dd>{email.sender.email}</dd>
                  <dt>To</dt>
                  <dd>{email.recipient}</dd>
                  <dt>Requested</dt>
                  <dd>
                    <LocalTime value={email.requestedAt} />
                  </dd>
                  <dt>Scheduled</dt>
                  <dd>
                    <LocalTime value={email.scheduledAt} />
                  </dd>
                  <dt>Sent</dt>
                  <dd>
                    <LocalTime value={email.sentAt} />
                  </dd>
                </dl>
              </details>
            </div>
            <span className="email-detail-date">
              <LocalTime
                value={email.sentAt ?? email.failedAt ?? email.scheduledAt}
              />
            </span>
          </div>
          <div className="email-message">
            <div className="email-message-status">
              <DeliveryBadge email={email} />
              {email.archived && (
                <span className="email-archived-label">Archived</span>
              )}
            </div>
            {email.status === "FAILED" && (
              <p className="email-outcome-note" role="status">
                This email could not be sent
                {email.lastErrorCode === "SMTP_RETRIES_EXHAUSTED"
                  ? " after the available retries"
                  : ""}
                . Check the delivery information below.
              </p>
            )}
            {email.status === "DELIVERY_UNCERTAIN" && (
              <p className="email-outcome-note" role="status">
                Delivery confirmation is unavailable. Check the captured message
                before sending again.
              </p>
            )}
            {email.deferredReason && (
              <p className="email-delay-note">
                {email.deferredReason === "SENDER_HOURLY_LIMIT"
                  ? "This sender has reached its hourly allowance."
                  : email.deferredReason === "BATCH_HOURLY_LIMIT"
                    ? "This batch has reached its hourly allowance."
                    : email.deferredReason === "RETRY_BACKOFF"
                      ? "A temporary delivery issue will be retried."
                      : "This email is waiting for its next delivery slot."}{" "}
                Next eligible time: <LocalTime value={email.scheduledAt} />.
              </p>
            )}
            {email.bodyHtml ? (
              <div
                className="email-body email-rich-body"
                dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
              />
            ) : (
              <div className="email-body">{email.body}</div>
            )}
            <AttachmentCards files={email.attachments} />
            {email.previewUrl && (
              <a
                className="email-preview-link"
                href={email.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View captured message ↗
              </a>
            )}
            <details className="email-delivery-info">
              <summary>Delivery information</summary>
              <dl>
                <dt>Requested</dt>
                <dd>
                  <LocalTime value={email.requestedAt} />
                </dd>
                <dt>Current send time</dt>
                <dd>
                  <LocalTime value={email.scheduledAt} />
                </dd>
                <dt>Sent</dt>
                <dd>
                  <LocalTime value={email.sentAt} />
                </dd>
                <dt>Attempts</dt>
                <dd>{email.attemptsMade}</dd>
                {email.lastErrorCode && (
                  <>
                    <dt>Delivery code</dt>
                    <dd>{email.lastErrorCode}</dd>
                  </>
                )}
                {email.messageId && (
                  <>
                    <dt>Message ID</dt>
                    <dd>{email.messageId}</dd>
                  </>
                )}
              </dl>
              {email.attempts.length > 0 && (
                <ol>
                  {email.attempts.map((attempt) => (
                    <li key={attempt.id}>
                      Attempt {attempt.number}:{" "}
                      {attempt.outcome.replaceAll("_", " ").toLowerCase()}
                      {attempt.smtpResponseCode
                        ? ` (${attempt.smtpResponseCode})`
                        : ""}{" "}
                      ·{" "}
                      <LocalTime
                        value={attempt.startedAt ?? attempt.reservedAt}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </details>
          </div>
        </article>
      )}
    </main>
  );
}
