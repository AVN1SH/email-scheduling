"use client";

import { useState, type KeyboardEvent } from "react";
import {
  MAX_RECIPIENTS,
  recipientAddressSchema,
  type LeadImportResult,
} from "@repo/shared";
import { MailIcon } from "../mailbox/icons";
import { importLeadFile } from "./compose-api";

export function parseRecipientInput(input: string) {
  const candidates = input
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const invalid = candidates.filter(
    (value) => !recipientAddressSchema.safeParse(value).success,
  );
  return { candidates, invalid };
}
export function Recipients({
  value,
  onChange,
  input,
  onInput,
  csrfToken,
  disabled,
  onBusy,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  input: string;
  onInput: (value: string) => void;
  csrfToken: string;
  disabled: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<
      (LeadImportResult & { filename: string }) | null
    >(null),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  function add(candidates: string[]) {
    const merged = [...new Set([...value, ...candidates])];
    if (merged.length > MAX_RECIPIENTS) {
      setError("Use at most 5,000 recipients.");
      return false;
    }
    const duplicates = value.length + candidates.length - merged.length;
    onChange(merged);
    setNotice(
      `${candidates.length - duplicates} added${duplicates ? `; ${duplicates} duplicates skipped` : ""}.`,
    );
    setError("");
    return true;
  }
  function commit() {
    const parsed = parseRecipientInput(input);
    if (parsed.invalid.length) {
      setError(
        `Correct these addresses: ${parsed.invalid.slice(0, 5).join(", ")}`,
      );
      return;
    }
    if (parsed.candidates.length && add(parsed.candidates)) onInput("");
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";"].includes(event.key)) {
      event.preventDefault();
      commit();
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setLoading(true);
    onBusy(true);
    setError("");
    setReport(null);
    try {
      setReport({
        ...(await importLeadFile(file, csrfToken)),
        filename: file.name,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not import the file.",
      );
      onBusy(false);
    } finally {
      setLoading(false);
    }
  }
  function closeReport(accept: boolean) {
    if (accept && report && !add(report.recipients)) return;
    setReport(null);
    onBusy(false);
  }
  const shown = expanded ? value : value.slice(0, 3);
  return (
    <div className="compose-recipient-section">
      <div className="compose-field compose-to-row">
        <label htmlFor="compose-recipients">To</label>
        <div className="compose-recipient-editor">
          {shown.map((email) => (
            <span className="recipient-chip" key={email}>
              {email}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove recipient ${email}`}
                onClick={() => onChange(value.filter((item) => item !== email))}
              >
                ×
              </button>
            </span>
          ))}
          {!expanded && value.length > 3 && (
            <button
              type="button"
              className="recipient-chip recipient-overflow"
              onClick={() => setExpanded(true)}
            >
              +{value.length - 3}
            </button>
          )}
          {expanded && value.length > 3 && (
            <button
              type="button"
              className="mail-text-button"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
          <input
            id="compose-recipients"
            type="text"
            placeholder={
              value.length ? "Add recipient" : "recipient@example.com"
            }
            value={input}
            disabled={disabled}
            onChange={(event) => {
              onInput(event.target.value);
              setError("");
            }}
            onKeyDown={key}
            onBlur={commit}
            autoComplete="off"
          />
        </div>
        <label
          className={`compose-upload-label${disabled || loading ? " is-disabled" : ""}`}
        >
          <MailIcon name="upload" width={13} height={13} />
          {loading ? "Reading…" : "Upload List"}
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            disabled={disabled || loading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void upload(file);
            }}
          />
        </label>
      </div>
      {value.length > 0 && (
        <p className="compose-field-note">
          {value.length} unique recipient{value.length === 1 ? "" : "s"}
        </p>
      )}
      {notice && (
        <p className="compose-field-note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="compose-validation" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="lead-import-report" role="status">
          <strong>{report.filename}</strong>
          <p>
            {report.detectedCount} valid addresses detected;{" "}
            {report.recipients.length} unique, {report.duplicateCount}{" "}
            duplicates, {report.invalidCount} invalid entries.
          </p>
          {report.invalidCount > 0 && (
            <details>
              <summary>
                Review invalid entries
                {report.invalidCount > report.invalid.length
                  ? " (first 100)"
                  : ""}
              </summary>
              <ul>
                {report.invalid.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            className="compose-primary"
            disabled={!report.recipients.length || disabled}
            onClick={() => closeReport(true)}
          >
            Add {report.recipients.length} valid recipients
          </button>
          <button
            type="button"
            className="mail-text-button"
            disabled={disabled}
            onClick={() => closeReport(false)}
          >
            Cancel import
          </button>
        </div>
      )}
    </div>
  );
}
