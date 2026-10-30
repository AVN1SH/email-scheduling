"use client";

import { useState } from "react";

export function localInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function SendLater({
  selected,
  onDone,
  onCancel,
}: {
  selected: string | null;
  onDone: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() =>
      selected ? localInput(new Date(selected)) : "",
    ),
    [error, setError] = useState("");
  function preset(hour: number) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(hour, 0, 0, 0);
    setDraft(localInput(date));
    setError("");
  }
  function done() {
    const date = new Date(draft);
    if (
      !draft ||
      !Number.isFinite(date.getTime()) ||
      localInput(date) !== draft ||
      date.getTime() <= Date.now()
    ) {
      setError("Choose a valid future date and local time.");
      return;
    }
    onDone(date.toISOString());
  }
  return (
    <div
      className="send-later-popover"
      role="dialog"
      aria-label="Send Later"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <h2>Send Later</h2>
      <label className="send-later-date-label">
        Pick date &amp; time
        <input
          aria-label="Send date and time"
          type="datetime-local"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
      </label>
      {[9, 10, 11, 15].map((hour) => (
        <button
          type="button"
          className="send-later-preset"
          key={hour}
          onClick={() => preset(hour)}
        >
          {hour === 9
            ? "Tomorrow"
            : `Tomorrow, ${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`}
        </button>
      ))}
      {error && (
        <p className="compose-validation" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" className="mail-text-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="compose-primary" onClick={done}>
          Done
        </button>
      </footer>
    </div>
  );
}
