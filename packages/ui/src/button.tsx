import type { ComponentProps } from "react";

const variants = {
  primary: "bg-accent text-white hover:brightness-95",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-background",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
