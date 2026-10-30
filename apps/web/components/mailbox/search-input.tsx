"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function SearchInput({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  const [submitted, setSubmitted] = useState<string[]>([]);
  // A completed URL update must not replace keystrokes typed after submission.
  if (previous !== initial) {
    setPrevious(initial);
    const position = submitted.indexOf(initial);
    setSubmitted(position < 0 ? [] : submitted.slice(position + 1));
    if (position < 0) setValue(initial);
  }
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (value.trim() === initial) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      next.set("page", "1");
      setSubmitted((pending) => [...pending, value.trim()]);
      router.replace(`/dashboard?${next}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, initial, params, router]);
  return (
    <>
      <input
        aria-label="Search emails"
        type="search"
        placeholder="Search"
        maxLength={200}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {value && (
        <button
          className="mail-text-button"
          aria-label="Clear search"
          onClick={() => setValue("")}
        >
          Clear
        </button>
      )}
    </>
  );
}
