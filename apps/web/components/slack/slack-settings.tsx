"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  slackStatusSchema,
  slackAuthorizationSchema,
  type AuthResponse,
} from "@repo/shared";
import { Button } from "@repo/ui/button";
import { mailRequest } from "../mailbox/mail-api";
import { useMailResource } from "../mailbox/use-mail-resource";

const callbackMessages: Record<string, string> = {
  connected: "Slack is connected.",
  cancelled:
    "Slack connection was cancelled. Your previous connection is unchanged.",
  invalid_state:
    "That Slack authorization expired or belongs to another session. Please connect again.",
  changed:
    "Your connection changed while authorization was in progress. Please connect again.",
  failed:
    "Slack could not complete authorization. Check your app configuration and try again.",
};
export function SlackSettings({ session }: { session: AuthResponse }) {
  const resource = useMailResource("/integrations/slack", slackStatusSchema);
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const status = resource.data;
  async function connect() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await mailRequest(
        "/integrations/slack/connect",
        slackAuthorizationSchema,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
          },
          body: "{}",
        },
      );
      window.location.assign(result.authorizationUrl);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not connect Slack. Try again.",
      );
      setPending(false);
    }
  }
  async function disconnect() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await mailRequest(
        "/integrations/slack",
        { parse: () => undefined },
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
          },
          body: "{}",
        },
      );
      resource.setData((previous) => ({ ...previous, connection: null }));
      resource.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not disconnect Slack. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  const callback = params.get("slack");
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/dashboard" className="text-sm text-[#17643a] underline">
        Back to emails
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">Slack notifications</h1>
      <p className="mt-2 text-sm text-muted">
        Receive an alert when a sender or batch reaches its hourly limit. Queued
        emails resume when the limit resets.
      </p>
      {callback &&
        callbackMessages[callback] &&
        (callback !== "connected" || status?.connection) && (
          <p role="status" className="mt-4 text-sm">
            {callbackMessages[callback]}
          </p>
        )}
      {(error || resource.error) && (
        <div role="alert" className="mail-alert mt-4">
          {error || resource.error}
          <button className="mail-text-button" onClick={resource.refresh}>
            Try again
          </button>
        </div>
      )}
      {!status && !resource.error ? (
        <p role="status" className="mt-6">
          Loading Slack connection...
        </p>
      ) : (
        status && (
          <section
            className="mt-6 rounded-xl border border-border bg-white p-6"
            aria-label="Slack connection"
          >
            {status.connection ? (
              <>
                <h2 className="font-semibold">
                  Connected to {status.connection.teamName}
                </h2>
                <p className="mt-2 text-sm">
                  Channel:{" "}
                  {status.connection.channelName.startsWith("#")
                    ? status.connection.channelName
                    : `#${status.connection.channelName}`}
                </p>
                {status.connection.needsReconnect && (
                  <p role="alert" className="mt-3 text-sm text-red-700">
                    Slack could not receive notifications. Reconnect to
                    authorize a working channel.
                  </p>
                )}
              </>
            ) : (
              <h2 className="font-semibold">Slack is not connected</h2>
            )}
            {!status.configured ? (
              <p className="mt-3 text-sm text-muted">
                Slack setup is required before you can connect.
              </p>
            ) : !status.ready ? (
              <p className="mt-3 text-sm text-muted">
                Open the app using its configured HTTPS address after completing
                the Slack callback setup.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                disabled={pending || !status.ready}
                onClick={() => void connect()}
              >
                {pending
                  ? "Please wait..."
                  : status.connection
                    ? "Reconnect Slack"
                    : "Connect Slack"}
              </Button>
              {status.connection && (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </section>
        )
      )}
    </main>
  );
}
