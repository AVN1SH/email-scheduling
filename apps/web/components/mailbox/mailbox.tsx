"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  emailQuerySchema,
  emailsResponseSchema,
  sendersResponseSchema,
  type AuthResponse,
  type EmailSummary,
  type EmailUpdate,
  type SafeSender,
} from "@repo/shared";
import { AccountMenu, Avatar } from "../auth/account-menu";
import { MailIcon } from "./icons";
import { useMailResource } from "./use-mail-resource";
import { mailRequest, updateEmail, deleteEmail } from "./mail-api";
import { EmailActions, confirmEmailDeletion } from "./email-actions";
import { DeliveryBadge, LocalTime, statusLabels } from "./email-presentation";
import { SearchInput } from "./search-input";

const views = {
  inbox: "Inbox",
  starred: "Starred",
  archived: "Archived",
  all: "All mail",
};
export function Mailbox({ session }: { session: AuthResponse }) {
  const searchParams = useSearchParams(),
    router = useRouter();
  const parsed = emailQuerySchema.safeParse(Object.fromEntries(searchParams));
  const query = parsed.success ? parsed.data : emailQuerySchema.parse({});
  const mailbox = query.mailbox ?? "scheduled";
  const params = new URLSearchParams({
    mailbox,
    view: query.view,
    page: String(query.page),
    pageSize: "20",
  });
  if (query.status) params.set("status", query.status);
  if (query.senderId) params.set("senderId", query.senderId);
  if (query.q) params.set("q", query.q);
  const queryString = params.toString();
  const resource = useMailResource(
    `/emails?${queryString}`,
    emailsResponseSchema,
  );
  const [senders, setSenders] = useState<SafeSender[]>([]),
    [pending, setPending] = useState<string | null>(null),
    [actionError, setActionError] = useState("");
  const lastPage = Math.max(
    1,
    resource.data?.pagination.totalPages ?? query.page,
  );
  useEffect(() => {
    if (query.page > lastPage) {
      const next = new URLSearchParams(queryString);
      next.set("page", String(lastPage));
      router.replace(`/dashboard?${next.toString()}`, { scroll: false });
    }
  }, [query.page, lastPage, queryString, router]);
  useEffect(() => {
    const controller = new AbortController();
    void mailRequest("/senders", sendersResponseSchema, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => setSenders(result.items))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  function navigate(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(queryString);
    next.set("page", "1");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`/dashboard?${next.toString()}`, { scroll: false });
    setActionError("");
  }
  function folderHref(folder: "scheduled" | "sent") {
    const next = new URLSearchParams(queryString);
    next.set("mailbox", folder);
    next.set("page", "1");
    next.delete("status");
    return `/dashboard?${next.toString()}`;
  }
  async function change(email: EmailSummary, input?: EmailUpdate) {
    if (pending) return;
    if (!input && !confirmEmailDeletion(email)) return;
    setPending(email.id);
    setActionError("");
    try {
      if (input) {
        const updated = await updateEmail(email.id, input, session.csrfToken);
        resource.setData((value) => ({
          ...value,
          items: value.items.map((item) =>
            item.id === email.id ? updated : item,
          ),
        }));
      } else {
        await deleteEmail(email.id, session.csrfToken);
        resource.setData((value) => ({
          ...value,
          items: value.items.filter((item) => item.id !== email.id),
        }));
      }
      resource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not update this email. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }
  const data = resource.data;
  const statuses =
    mailbox === "scheduled"
      ? (["PENDING_DISPATCH", "SCHEDULED", "PROCESSING", "RETRYING"] as const)
      : (["SENT", "FAILED", "DELIVERY_UNCERTAIN"] as const);
  return (
    <div className="mailbox-shell">
      <aside className="mailbox-sidebar">
        <Link
          href="/dashboard"
          className="mailbox-logo"
          aria-label="Outbox home"
        >
          Outbox
        </Link>
        <AccountMenu session={session} />
        <Link
          href="/dashboard/compose"
          className="compose-button"
          title="Compose email"
        >
          Compose
        </Link>
        <p className="mailbox-section-label">CORE</p>
        <nav aria-label="Mailboxes" className="mailbox-navigation">
          {(["scheduled", "sent"] as const).map((folder) => (
            <Link
              key={folder}
              href={folderHref(folder)}
              onClick={() => setActionError("")}
              aria-current={folder === mailbox ? "page" : undefined}
              className={folder === mailbox ? "is-active" : ""}
            >
              <MailIcon name={folder === "scheduled" ? "clock" : "send"} />
              <span>{folder === "scheduled" ? "Scheduled" : "Sent"}</span>
              <span className="mailbox-count">
                {data?.counts[folder] ?? "—"}
              </span>
            </Link>
          ))}
        </nav>
      </aside>
      <main
        className="mailbox-main"
        aria-label={`${mailbox === "scheduled" ? "Scheduled" : "Sent"} emails`}
      >
        <header className="mail-toolbar">
          <div className="mail-search">
            <MailIcon name="search" width={15} height={15} />
            <SearchInput initial={query.q ?? ""} />
          </div>
          <details className="mail-filters">
            <summary
              className="mail-icon-button"
              aria-label="Filter emails"
              title="Filter emails"
            >
              <MailIcon name="filter" />
              {(query.view !== "inbox" || query.senderId || query.status) && (
                <span className="filter-dot" />
              )}
            </summary>
            <div className="mail-filter-popover">
              <h2>Filter emails</h2>
              <label>
                Show
                <select
                  value={query.view}
                  onChange={(event) => navigate({ view: event.target.value })}
                >
                  {Object.entries(views).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sender
                <select
                  value={query.senderId ?? ""}
                  onChange={(event) =>
                    navigate({ senderId: event.target.value || undefined })
                  }
                >
                  <option value="">All senders</option>
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={query.status ?? ""}
                  onChange={(event) =>
                    navigate({ status: event.target.value || undefined })
                  }
                >
                  <option value="">All statuses</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="mail-text-button"
                onClick={() =>
                  navigate({
                    view: "inbox",
                    senderId: undefined,
                    status: undefined,
                  })
                }
              >
                Reset filters
              </button>
            </div>
          </details>
          <button
            className="mail-icon-button"
            aria-label="Refresh emails"
            title="Refresh"
            disabled={resource.refreshing}
            onClick={resource.refresh}
          >
            <MailIcon
              name="refresh"
              className={resource.refreshing ? "mail-spin" : ""}
            />
          </button>
          <div className="mail-toolbar-account">
            <Avatar user={session.user} />
            <div>
              <span>{session.user.name ?? "Your account"}</span>
              <small>{session.user.email}</small>
            </div>
          </div>
        </header>
        {(query.view !== "inbox" || query.senderId || query.status) && (
          <div className="mail-active-filters">
            <span>
              {views[query.view]}
              {query.status ? ` · ${statusLabels[query.status]}` : ""}
            </span>
            <button
              className="mail-text-button"
              onClick={() =>
                navigate({
                  view: "inbox",
                  senderId: undefined,
                  status: undefined,
                })
              }
            >
              Clear filters
            </button>
          </div>
        )}
        {(actionError || resource.error) && (
          <div className="mail-alert" role="alert">
            {actionError || resource.error}
            <button
              className="mail-text-button"
              onClick={() => {
                setActionError("");
                resource.refresh();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {!data && !resource.error ? (
          <div className="mail-list-loading" role="status">
            Loading emails…
          </div>
        ) : data && !data.items.length ? (
          <div className="mail-empty">
            <h1>
              {query.q
                ? "No emails match your search"
                : query.view === "inbox" && !query.status && !query.senderId
                  ? `No ${mailbox} emails`
                  : "No emails match these filters"}
            </h1>
            <p>
              {query.q
                ? "Try different words or adjust your filters. Newly scheduled emails may take a few seconds to appear."
                : query.view === "archived"
                  ? "Archived messages will appear here."
                  : query.view === "starred"
                    ? "Star an email to find it here."
                    : mailbox === "sent"
                      ? "Sent emails and delivery outcomes will appear here."
                      : "Your upcoming emails will appear here."}
            </p>
          </div>
        ) : (
          <ul className="mail-list">
            {data?.items.map((email) => (
              <li key={email.id} className="mail-row">
                <Link
                  href={`/dashboard/emails/${email.id}?from=${encodeURIComponent(queryString)}`}
                  className="mail-row-link"
                  aria-label={`Open ${email.subject} to ${email.recipient}`}
                >
                  <span className="mail-recipient" title={email.recipient}>
                    To: {email.recipient}
                  </span>
                  <DeliveryBadge email={email} showTime />
                  <span className="mail-row-content">
                    <span className="mail-subject">{email.subject}</span>
                    <span className="mail-preview"> – {email.bodyPreview}</span>
                  </span>
                  {mailbox === "sent" && (
                    <span className="mail-row-date">
                      <LocalTime
                        value={
                          email.sentAt ?? email.failedAt ?? email.requestedAt
                        }
                      />
                    </span>
                  )}
                </Link>
                <EmailActions
                  email={email}
                  pending={pending !== null}
                  compact
                  onUpdate={(input) => void change(email, input)}
                  onDelete={() => void change(email)}
                />
              </li>
            ))}
          </ul>
        )}
        {data && data.pagination.totalPages > 1 && (
          <nav className="mail-pagination" aria-label="Email pages">
            <span>
              {(query.page - 1) * data.pagination.pageSize + 1}–
              {Math.min(
                query.page * data.pagination.pageSize,
                data.pagination.total,
              )}{" "}
              of {data.pagination.total}
            </span>
            <button
              className="mail-icon-button"
              aria-label="Previous page"
              disabled={query.page <= 1}
              onClick={() => navigate({ page: String(query.page - 1) })}
            >
              <MailIcon name="chevronLeft" />
            </button>
            <button
              className="mail-icon-button"
              aria-label="Next page"
              disabled={query.page >= data.pagination.totalPages}
              onClick={() => navigate({ page: String(query.page + 1) })}
            >
              <MailIcon name="chevronRight" />
            </button>
          </nav>
        )}
      </main>
    </div>
  );
}
