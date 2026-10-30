"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { loginRequestSchema, registerRequestSchema } from "@repo/shared";
import { submitAuth } from "../../lib/api";

function GoogleMark() {
  return <Image src="/google-g.png" alt="" width={14} height={14} />;
}

export function AuthForm({
  mode,
  initialError,
}: {
  mode: "login" | "register";
  initialError?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState(initialError ?? "");
  const [pending, setPending] = useState(false);
  const register = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const raw = {
      email: form.get("email"),
      password: form.get("password"),
      ...(register ? { name: form.get("name") } : {}),
    };
    const input = (
      register ? registerRequestSchema : loginRequestSchema
    ).safeParse(raw);
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "Check the entered details.");
      return;
    }
    setError("");
    setPending(true);
    try {
      await submitAuth(register ? "register" : "login", input.data);
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to sign in. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-5 py-12">
      <section
        aria-labelledby="auth-heading"
        className="w-full max-w-[400px] rounded-lg border border-[#e9edef] bg-white px-8 py-10 sm:px-11"
      >
        <h1
          id="auth-heading"
          className="mb-6 text-center text-[30px] font-semibold tracking-tight"
        >
          {register ? "Create account" : "Login"}
        </h1>
        <a
          href="/api/auth/google"
          className="flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#e4f5ec] text-[13px] text-[#202925] hover:bg-[#d7efdf]"
        >
          <GoogleMark /> Login with Google
        </a>
        <div className="my-5 flex items-center gap-3 text-[11px] tracking-wide text-[#9b9fa1]">
          <span className="h-px flex-1 bg-[#e7ebed]" />
          {register ? (
            <span>or sign up through email</span>
          ) : (
            <span>
              or{" "}
              <Link
                href="/signup"
                className="hover:text-accent hover:underline"
              >
                sign up through email
              </Link>
            </span>
          )}
          <span className="h-px flex-1 bg-[#e7ebed]" />
        </div>
        <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
          {register && (
            <div>
              <label htmlFor="name" className="sr-only">
                Name
              </label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Name"
                required
                maxLength={80}
                disabled={pending}
                className="h-12 border-0 bg-[#f4f7f5] px-4 text-[13px]"
              />
            </div>
          )}
          <div>
            <label htmlFor="email" className="sr-only">
              Email ID
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Email ID"
              required
              maxLength={254}
              disabled={pending}
              className="h-12 border-0 bg-[#f4f7f5] px-4 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              placeholder="Password"
              required
              minLength={register ? 12 : 1}
              maxLength={128}
              disabled={pending}
              aria-describedby={register ? "password-help" : undefined}
              className="h-12 border-0 bg-[#f4f7f5] px-4 text-[13px]"
            />
          </div>
          {register && (
            <p id="password-help" className="text-xs leading-5 text-muted">
              Use 12–128 characters.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm leading-5 text-red-700">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="mt-2 h-10 w-full rounded-[9px] text-[13px]"
          >
            {pending ? "Please wait…" : register ? "Create account" : "Login"}
          </Button>
        </form>
        {register && (
          <p className="mt-5 text-center text-xs text-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-accent hover:underline"
            >
              Login
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
