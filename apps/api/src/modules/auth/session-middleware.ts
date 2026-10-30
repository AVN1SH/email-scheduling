import session from "express-session";
import type { AuthEnvironment } from "../../config/auth-environment.js";
import { SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session-store.js";

export function sessionCookie(environment: AuthEnvironment) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: environment.secureCookies,
    path: "/",
    maxAge: SESSION_LIFETIME_MS,
  };
}

export function createSessionMiddleware(
  environment: AuthEnvironment,
  store: session.Store,
) {
  return session({
    name: SESSION_COOKIE,
    secret: environment.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    proxy: true,
    cookie: sessionCookie(environment),
  });
}
