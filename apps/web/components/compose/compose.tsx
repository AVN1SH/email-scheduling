"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  composeOptionsSchema,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MAX_RECIPIENTS,
  scheduleRequestSchema,
  scheduleResponseSchema,
  sendersResponseSchema,
  type Attachment,
  type AuthResponse,
  type ScheduleRequest,
} from "@repo/shared";
import { MailIcon } from "../mailbox/icons";
import { LocalTime } from "../mailbox/email-presentation";
import { mailRequest, MailApiError } from "../mailbox/mail-api";
import { AttachmentCards } from "./attachment-cards";
import {
  jsonMutation,
  removeAttachment,
  uploadAttachment,
} from "./compose-api";
import { Recipients, parseRecipientInput } from "./recipients";
import { RichTextEditor } from "./rich-text-editor";
import { SendLater } from "./send-later";

export function Compose({ session }: { session: AuthResponse }) {
  const router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null);
  const [setup, setSetup] = useState<{
    senders: ReturnType<typeof sendersResponseSchema.parse>["items"];
    options: ReturnType<typeof composeOptionsSchema.parse>;
  } | null>(null);
  const [setupVersion, setSetupVersion] = useState(0),
    [setupError, setSetupError] = useState("");
  const [senderId, setSenderId] = useState(""),
    [recipients, setRecipients] = useState<string[]>([]),
    [recipientInput, setRecipientInput] = useState("");
  const [subject, setSubject] = useState(""),
    [content, setContent] = useState({ html: "", text: "" }),
    [delay, setDelay] = useState(""),
    [hourly, setHourly] = useState("");
  const [startAt, setStartAt] = useState<string | null>(null),
    [laterOpen, setLaterOpen] = useState(false),
    [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{
      signature: string;
      key: string;
      payload: ScheduleRequest;
    } | null>(null),
    sending = useRef(false);
  const dirty = !!(
    subject ||
    content.text.trim() ||
    recipients.length ||
    recipientInput ||
    files.length
  );
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    void Promise.all([
      mailRequest("/senders", sendersResponseSchema, { signal }),
      mailRequest("/compose/options", composeOptionsSchema, { signal }),
    ])
      .then(([senders, options]) => {
        if (controller.signal.aborted) return;
        setSetup({ senders: senders.items, options });
        setSetupError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof MailApiError && error.status === 401)
          router.replace("/login");
        setSetupError(
          error instanceof Error
            ? error.message
            : "Could not load sender settings.",
        );
      });
    return () => controller.abort();
  }, [setupVersion, router]);
  useEffect(() => {
    if (!dirty) return;
    const confirm = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirm);
    return () => window.removeEventListener("beforeunload", confirm);
  }, [dirty]);
  async function back() {
    if (pending || uploading || sending.current) return;
    if (dirty && !window.confirm("Discard this email draft?")) return;
    await Promise.allSettled(
      files.map((file) => removeAttachment(file.id, session.csrfToken)),
    );
    router.push("/dashboard");
  }
  async function attach(selected: FileList | null) {
    if (!selected?.length) return;
    const candidates = [...selected];
    if (
      files.length + candidates.length > MAX_ATTACHMENTS ||
      [...files, ...candidates].reduce((sum, file) => sum + file.size, 0) >
        MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      setError("Use at most 10 attachments totalling 20 MB.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of candidates) {
        const uploaded = await uploadAttachment(file, session.csrfToken);
        setFiles((previous) => [...previous, uploaded]);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Attachment upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function remove(file: Attachment) {
    setUploading(true);
    setError("");
    try {
      await removeAttachment(file.id, session.csrfToken);
      setFiles((previous) => previous.filter((item) => item.id !== file.id));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not remove the attachment.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function submit() {
    if (sending.current || pending || uploading || importBusy || !setup) return;
    setError("");
    const parsedRecipients = parseRecipientInput(recipientInput);
    if (parsedRecipients.invalid.length) {
      setError("Correct the invalid recipient addresses first.");
      return;
    }
    const allRecipients = [
      ...new Set([...recipients, ...parsedRecipients.candidates]),
    ];
    if (!allRecipients.length || allRecipients.length > MAX_RECIPIENTS) {
      setError("Enter between 1 and 5,000 unique recipients.");
      return;
    }
    if (!subject.trim() || !content.text.trim()) {
      setError("Enter a subject and message body.");
      return;
    }
    const delayMs =
      delay === "" ? setup.options.minDelayMs : Number(delay) * 1000;
    const hourlyLimit =
      hourly === "" ? setup.options.maxHourlyLimit : Number(hourly);
    if (
      !Number.isInteger(delayMs) ||
      delayMs < setup.options.minDelayMs ||
      delayMs > 86400000
    ) {
      setError(
        `Delay must be between ${setup.options.minDelayMs / 1000} and 86,400 seconds.`,
      );
      return;
    }
    if (
      !Number.isInteger(hourlyLimit) ||
      hourlyLimit < 1 ||
      hourlyLimit > setup.options.maxHourlyLimit
    ) {
      setError(
        `Hourly limit must be between 1 and ${setup.options.maxHourlyLimit}.`,
      );
      return;
    }
    const values = {
      senderId: senderId || setup.senders[0]?.id,
      recipients: allRecipients,
      subject: subject.trim(),
      body: content.text,
      bodyHtml: content.html,
      delayMs,
      hourlyLimit,
      attachmentIds: files.map((file) => file.id),
    };
    const signature = JSON.stringify({ ...values, startAt });
    if (request.current?.signature !== signature) {
      if (startAt && new Date(startAt).getTime() <= Date.now()) {
        setError("Choose a future send time, or clear it to send now.");
        return;
      }
      const payload = scheduleRequestSchema.safeParse({
        ...values,
        startAt: startAt ?? new Date().toISOString(),
      });
      if (!payload.success) {
        setError(
          "Check the sender, subject/body length, recipients, and delivery settings.",
        );
        return;
      }
      request.current = {
        signature,
        key: crypto.randomUUID(),
        payload: payload.data,
      };
    }
    const attempt = request.current;
    sending.current = true;
    setPending(true);
    try {
      const init = jsonMutation(attempt.payload, session.csrfToken);
      await mailRequest("/emails/schedule", scheduleResponseSchema, {
        ...init,
        headers: { ...init.headers, "Idempotency-Key": attempt.key },
      });
      router.push("/dashboard?mailbox=scheduled");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof MailApiError
          ? error.message
          : "Could not confirm scheduling. Retry without editing to safely check the same request.",
      );
      sending.current = false;
      setPending(false);
    }
  }
  const disabled = pending || uploading;
  return (
    <main className="compose-page">
      <header className="compose-header">
        <button
          type="button"
          className="mail-icon-button"
          aria-label="Back to emails"
          disabled={disabled}
          onClick={() => void back()}
        >
          <MailIcon name="back" />
        </button>
        <h1>Compose New Email</h1>
        <div className="compose-header-actions">
          <button
            type="button"
            className={`mail-icon-button${files.length ? " compose-selected" : ""}`}
            aria-label="Attach files"
            title="Attach files"
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            <MailIcon name="attachment" />
            {files.length > 0 && <small>{files.length}</small>}
          </button>
          <div className="compose-send-later-anchor">
            <button
              type="button"
              className={`mail-icon-button${startAt ? " compose-selected" : ""}`}
              aria-label="Choose send time"
              title="Send Later"
              aria-expanded={laterOpen}
              disabled={disabled}
              onClick={() => setLaterOpen((previous) => !previous)}
            >
              <MailIcon name="clock" />
            </button>
            {laterOpen && (
              <SendLater
                selected={startAt}
                onCancel={() => setLaterOpen(false)}
                onDone={(value) => {
                  setStartAt(value);
                  setLaterOpen(false);
                }}
              />
            )}
          </div>
          <button
            type="button"
            className="compose-primary"
            disabled={
              disabled || importBusy || laterOpen || !setup?.senders.length
            }
            onClick={() => void submit()}
          >
            {pending ? "Scheduling…" : startAt ? "Send Later" : "Send"}
          </button>
        </div>
      </header>
      <input
        type="file"
        multiple
        ref={fileInput}
        className="compose-hidden-input"
        disabled={disabled}
        onChange={(event) => {
          void attach(event.target.files);
          event.target.value = "";
        }}
      />
      <section className="compose-content" aria-label="New email">
        {(error || setupError) && (
          <div className="mail-alert" role="alert">
            {error || setupError}
            {setupError && (
              <button
                type="button"
                className="mail-text-button"
                onClick={() => setSetupVersion((previous) => previous + 1)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {!setup && !setupError && <p role="status">Loading sender settings…</p>}
        {setup && !setup.senders.length && (
          <p className="mail-alert" role="status">
            No sender accounts are available. Import your Ethereal sender
            accounts before scheduling.
          </p>
        )}
        <div className="compose-field compose-from-row">
          <label htmlFor="compose-sender">From</label>
          <select
            id="compose-sender"
            value={senderId || setup?.senders[0]?.id || ""}
            disabled={disabled || !setup?.senders.length}
            onChange={(event) => setSenderId(event.target.value)}
          >
            {!setup?.senders.length && <option value="">No sender</option>}
            {setup?.senders.map((sender) => (
              <option value={sender.id} key={sender.id}>
                {sender.email}
              </option>
            ))}
          </select>
        </div>
        <Recipients
          value={recipients}
          onChange={setRecipients}
          input={recipientInput}
          onInput={setRecipientInput}
          csrfToken={session.csrfToken}
          disabled={pending}
          onBusy={setImportBusy}
        />
        <div className="compose-field">
          <label htmlFor="compose-subject">Subject</label>
          <input
            id="compose-subject"
            placeholder="Subject"
            maxLength={998}
            value={subject}
            disabled={pending}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="compose-delivery-settings">
          <label htmlFor="compose-delay">
            Delay between 2 emails{" "}
            <span className="compose-unit">(seconds)</span>
          </label>
          <input
            id="compose-delay"
            type="number"
            min={(setup?.options.minDelayMs ?? 0) / 1000}
            max={86400}
            step="0.001"
            placeholder={String((setup?.options.minDelayMs ?? 2000) / 1000)}
            value={delay}
            disabled={pending}
            onChange={(event) => setDelay(event.target.value)}
          />
          <label htmlFor="compose-hourly">Hourly Limit</label>
          <input
            id="compose-hourly"
            type="number"
            min={1}
            max={setup?.options.maxHourlyLimit}
            step={1}
            placeholder={String(setup?.options.maxHourlyLimit ?? 200)}
            value={hourly}
            disabled={pending}
            onChange={(event) => setHourly(event.target.value)}
          />
        </div>
        {startAt && (
          <div className="compose-start-time">
            <span>
              Start time: <LocalTime value={startAt} />
            </span>
            <button
              type="button"
              className="mail-text-button"
              disabled={pending}
              onClick={() => setStartAt(null)}
            >
              Clear to send now
            </button>
          </div>
        )}
        <RichTextEditor
          onChange={(html, text) => setContent({ html, text })}
          disabled={pending}
        />
        <AttachmentCards
          files={files}
          disabled={disabled}
          onRemove={(file) => void remove(file)}
        />
        {uploading && (
          <p className="compose-field-note" role="status">
            Updating attachments…
          </p>
        )}
      </section>
    </main>
  );
}
