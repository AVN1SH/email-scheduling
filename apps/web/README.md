# Web application

Next.js frontend on port 8000. Run `pnpm dev` from the repository root so Turborepo builds its shared dependencies before starting the web and API processes.

Browser requests to `/api/*` are proxied to Express. `API_INTERNAL_URL` is server-only and defaults to `http://127.0.0.1:4000`; override it in `.env.local` if the API address changes. A production build captures that rewrite destination, so rebuild after changing it.

Tailwind scans this app and `packages/ui/src`. Local font files avoid a runtime/build dependency on Google Fonts.

See the [root README](../../README.md) for application setup, credentials, and validation commands.
