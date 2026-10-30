"use client";

import { Button } from "@repo/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">
          We couldn’t load your account
        </h1>
        <p className="text-sm text-muted">Please try again in a moment.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
