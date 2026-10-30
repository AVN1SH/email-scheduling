export type SmtpResult = { messageId: string; previewUrl: string | null };
export type FailureKind = "retryable" | "permanent" | "uncertain";
export class SmtpFailure extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly code: string,
    public readonly responseCode?: number,
  ) {
    super(code);
    this.name = "SmtpFailure";
  }
}

export function classifySmtpFailure(
  error: unknown,
  submitting: boolean,
): SmtpFailure {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const responseCode =
    typeof details.responseCode === "number" ? details.responseCode : undefined;
  if (responseCode && responseCode >= 400 && responseCode < 500)
    return new SmtpFailure(
      "retryable",
      "SMTP_TEMPORARY_REJECTION",
      responseCode,
    );
  if (responseCode && responseCode >= 500 && responseCode < 600)
    return new SmtpFailure(
      "permanent",
      "SMTP_PERMANENT_REJECTION",
      responseCode,
    );
  if (details.code === "EAUTH")
    return new SmtpFailure("permanent", "SMTP_AUTH_FAILED");
  if (submitting) return new SmtpFailure("uncertain", "SMTP_OUTCOME_UNCERTAIN");
  if (
    details.code === "ETLS" ||
    (typeof details.code === "string" && /CERT|TLS|SSL/.test(details.code))
  )
    return new SmtpFailure("permanent", "SMTP_TLS_FAILED");
  return new SmtpFailure("retryable", "SMTP_CONNECTION_FAILED");
}
