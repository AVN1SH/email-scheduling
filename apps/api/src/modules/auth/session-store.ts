import { createHash } from "node:crypto";
import session, { type SessionData } from "express-session";
import type { Database, Prisma } from "@repo/db";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    googleOAuth?: {
      state: string;
      nonce: string;
      verifier: string;
      expiresAt: number;
    };
  }
}

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "email_scheduler_session";
const storageId = (id: string) => createHash("sha256").update(id).digest("hex");
const expiresAt = (value: SessionData) =>
  value.cookie.expires
    ? new Date(value.cookie.expires)
    : new Date(Date.now() + SESSION_LIFETIME_MS);

export class PostgresSessionStore extends session.Store {
  constructor(private readonly database: Database) {
    super();
  }

  override get(
    id: string,
    callback: (error: unknown, value?: SessionData | null) => void,
  ) {
    const read = async () => {
      const stored = await this.database.session.findUnique({
        where: { id: storageId(id) },
      });
      if (!stored) return null;
      if (stored.expiresAt.getTime() <= Date.now()) {
        await this.database.session.deleteMany({
          where: { id: storageId(id), expiresAt: { lte: new Date() } },
        });
        return null;
      }
      return stored.data as unknown as SessionData;
    };
    void read().then(
      (value) => callback(null, value),
      (error) => callback(error),
    );
  }

  override set(
    id: string,
    value: SessionData,
    callback: (error?: unknown) => void = () => {},
  ) {
    const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    const fields = {
      data,
      expiresAt: expiresAt(value),
      userId: value.userId ?? null,
    };
    const write = async () => {
      await this.database.session.upsert({
        where: { id: storageId(id) },
        create: { id: storageId(id), ...fields },
        update: fields,
      });
      await this.database.session.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
    };
    void write().then(
      () => callback(),
      (error) => callback(error),
    );
  }

  override destroy(id: string, callback: (error?: unknown) => void = () => {}) {
    void this.database.session
      .deleteMany({ where: { id: storageId(id) } })
      .then(
        () => callback(),
        (error) => callback(error),
      );
  }

  override touch(
    id: string,
    value: SessionData,
    callback: (error?: unknown) => void = () => {},
  ) {
    void this.database.session
      .updateMany({
        where: { id: storageId(id), expiresAt: { gt: new Date() } },
        data: { expiresAt: expiresAt(value) },
      })
      .then(
        () => callback(),
        (error) => callback(error),
      );
  }
}
