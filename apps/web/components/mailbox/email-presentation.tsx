"use client";

import { useSyncExternalStore } from "react";
import type { EmailStatus, EmailSummary } from "@repo/shared";
import { MailIcon } from "./icons";

const subscribe = () => () => {};
const client = () => true,
  server = () => false;
export function LocalTime({
  value,
  compact = false,
}: {
  value: string | null;
  compact?: boolean;
}) {
  const mounted = useSyncExternalStore(subscribe, client, server);
  if (!value) return <span>—</span>;
  const date = new Date(value);
  const label = mounted
    ? new Intl.DateTimeFormat(
        "en-US",
        compact
          ? {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            }
          : {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            },
      ).format(date)
    : "—";
  return (
    <time dateTime={value} title={value}>
      {label}
    </time>
  );
}
export const statusLabels: Record<EmailStatus, string> = {
  PENDING_DISPATCH: "Pending",
  SCHEDULED: "Scheduled",
  PROCESSING: "Sending",
  RETRYING: "Retrying",
  SENT: "Sent",
  FAILED: "Failed",
  DELIVERY_UNCERTAIN: "Needs verification",
  CANCELLED: "Cancelled",
};
export function DeliveryBadge({
  email,
  showTime = false,
}: {
  email: EmailSummary;
  showTime?: boolean;
}) {
  const scheduled = ["PENDING_DISPATCH", "SCHEDULED", "RETRYING"].includes(
    email.status,
  );
  const tone = scheduled
    ? "scheduled"
    : email.status === "FAILED"
      ? "failed"
      : email.status === "DELIVERY_UNCERTAIN"
        ? "uncertain"
        : email.status === "PROCESSING"
          ? "sending"
          : "sent";
  return (
    <span
      className={`delivery-badge delivery-badge-${tone}`}
      title={statusLabels[email.status]}
    >
      {scheduled && <MailIcon name="clock" width={12} height={12} />}{" "}
      {showTime && scheduled ? (
        <LocalTime value={email.scheduledAt} compact />
      ) : (
        statusLabels[email.status]
      )}
    </span>
  );
}
