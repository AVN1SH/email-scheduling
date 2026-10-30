"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MailApiError, mailRequest } from "./mail-api";

export function useMailResource<T>(
  path: string,
  schema: { parse(value: unknown): T },
) {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    path: string;
    version: number;
    value: T | null;
    error: string | null;
  }>({ path: "", version: -1, value: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await mailRequest(path, schema, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!controller.signal.aborted)
          setSnapshot({ path, version, value, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof MailApiError && error.status === 401) {
          router.replace("/login");
          router.refresh();
        }
        const message =
          error instanceof MailApiError
            ? error.message
            : "Email is temporarily unavailable. Please try again.";
        setSnapshot((previous) => ({
          path,
          version,
          value:
            previous.path === path &&
            !(
              error instanceof MailApiError && [401, 404].includes(error.status)
            )
              ? previous.value
              : null,
          error: message,
        }));
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void load(), 10000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, schema, version, router]);
  return {
    data: snapshot.path === path ? snapshot.value : null,
    error: snapshot.path === path ? snapshot.error : null,
    refreshing: snapshot.path !== path || snapshot.version !== version,
    refresh: () => setVersion((value) => value + 1),
    setData: (update: (value: T) => T) =>
      setSnapshot((previous) => ({
        ...previous,
        value: previous.value ? update(previous.value) : null,
      })),
  };
}
