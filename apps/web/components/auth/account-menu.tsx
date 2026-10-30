"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse, PublicUser } from "@repo/shared";
import { Button } from "@repo/ui/button";

export function Avatar({ user }: { user: PublicUser }) {
  return user.avatarUrl ? (
    <Image
      src={user.avatarUrl}
      alt=""
      width={36}
      height={36}
      unoptimized
      referrerPolicy="no-referrer"
      className="size-9 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#dff3e6] text-sm font-semibold text-[#17643a]"
    >
      {(user.name ?? user.email).slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AccountMenu({ session }: { session: AuthResponse }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: "{}",
      });
      if (!response.ok && response.status !== 401)
        throw new Error("Unable to log out. Please try again.");
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Unable to log out. Refresh the page and try again.");
      setPending(false);
    }
  }
  return (
    <div>
      <details className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl bg-[#f4f7f5] p-2 [&::-webkit-details-marker]:hidden">
          <Avatar user={session.user} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {session.user.name ?? "Your account"}
            </span>
            <span className="block truncate text-[11px] text-muted">
              {session.user.email}
            </span>
          </span>
          <span aria-hidden="true" className="text-muted">
            ⌄
          </span>
        </summary>
        <div className="absolute left-0 right-0 top-full z-10 mt-2 rounded-xl border border-border bg-white p-2 shadow-sm">
          <Link
            href="/dashboard/settings"
            className="mb-2 block rounded-lg px-3 py-2 text-sm hover:bg-[#f4f7f5]"
          >
            Connect Slack
          </Link>
          <Button
            variant="secondary"
            onClick={logout}
            disabled={pending}
            className="w-full"
          >
            {pending ? "Logging out…" : "Logout"}
          </Button>
        </div>
      </details>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
