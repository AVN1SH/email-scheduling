import nodemailer from "nodemailer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import type { SenderImport } from "@repo/shared";
import {
  classifySmtpFailure,
  SmtpFailure,
  type SmtpResult,
} from "./smtp-result.js";

export type SmtpMessage = {
  recipient: string;
  subject: string;
  body: string;
  bodyHtml?: string | null;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
  messageId: string;
};
export type SmtpSender = (
  credentials: SenderImport,
  message: SmtpMessage,
) => Promise<SmtpResult>;

export function createSmtpSender(
  timeoutMs: number,
  options?: (credentials: SenderImport) => SMTPConnection.Options,
): SmtpSender {
  return async (credentials, message) => {
    const composer = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const compiled = await composer.sendMail({
      from: { name: credentials.name, address: credentials.email },
      to: message.recipient,
      subject: message.subject,
      text: message.body,
      html: message.bodyHtml ?? undefined,
      attachments: message.attachments,
      messageId: message.messageId,
    });
    return new Promise<SmtpResult>((resolve, reject) => {
      const connection = new SMTPConnection(
        options?.(credentials) ?? {
          host: credentials.smtpHost,
          port: credentials.smtpPort,
          secure: credentials.smtpSecure,
          requireTLS: !credentials.smtpSecure,
          tls: { rejectUnauthorized: true },
          connectionTimeout: timeoutMs,
          greetingTimeout: timeoutMs,
          socketTimeout: timeoutMs,
          dnsTimeout: timeoutMs,
          logger: false,
        },
      );
      let settled = false,
        submitting = false;
      const finish = (error?: SmtpFailure, result?: SmtpResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.close();
        if (error) reject(error);
        else resolve(result!);
      };
      const fail = (error: unknown) =>
        finish(classifySmtpFailure(error, submitting));
      const timer = setTimeout(() => fail({ code: "ETIMEDOUT" }), timeoutMs);
      connection.on("error", fail);
      connection.on("end", () => {
        if (!settled) fail({ code: "ECONNRESET" });
      });
      connection.connect((error) => {
        if (settled) return;
        if (error) {
          fail(error);
          return;
        }
        connection.login(
          { user: credentials.smtpUser, pass: credentials.smtpPassword },
          (error) => {
            if (settled) return;
            if (error) {
              fail(error);
              return;
            }
            submitting = true;
            connection.send(
              { from: credentials.email, to: [message.recipient] },
              compiled.message,
              (error, info) => {
                if (settled) return;
                if (error) {
                  fail(error);
                  return;
                }
                if (!info?.accepted?.length) {
                  finish(
                    new SmtpFailure("permanent", "SMTP_RECIPIENT_REJECTED"),
                  );
                  return;
                }
                const preview = nodemailer.getTestMessageUrl({
                  response: info.response,
                });
                const previewUrl =
                  preview && new URL(preview).hostname === "ethereal.email"
                    ? preview
                    : null;
                finish(undefined, { messageId: message.messageId, previewUrl });
              },
            );
          },
        );
      });
    });
  };
}
