import type { ComponentProps } from "react";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`min-h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-700 ${className}`}
      {...props}
    />
  );
}
