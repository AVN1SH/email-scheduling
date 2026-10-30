# Outbox — Email scheduler

An email scheduling application with multiple SMTP senders, durable background delivery, indexed search, and Slack rate-limit notifications. Ethereal captures outgoing messages for inspection without delivering them to real inboxes.

## Features and architecture

The stack uses Next.js, Express, separate BullMQ dispatch/send/search/notification workers, Prisma on Neon PostgreSQL, and persistent Docker Redis/Elasticsearch. Authentication supports email/password and Google OAuth with PostgreSQL-backed sessions. Compose supports CSV/text recipient imports, rich text, attachments, and immediate or scheduled sending. The Scheduled/Sent mailbox provides counts, details, filters, search, and persisted star/archive/delete actions. SMTP credentials and Slack webhooks are encrypted in the database; Bull Board is restricted to verified administrators.

The two application workspaces are `apps/web` and `apps/api`. The worker runs separately from the API using the same backend workspace.

| Location          | Responsibility                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| `apps/web`        | Next.js on port 8000, Tailwind, browser-facing `/api` proxy            |
| `apps/api/src`    | Express on port 4000, configuration, health checks, worker runtime     |
| `packages/db`     | Prisma schema, versioned migrations, PostgreSQL client factory         |
| `packages/shared` | Zod response schemas and inferred TypeScript contracts                 |
| `packages/ui`     | Reusable React button/input foundations                                |
| `compose.yaml`    | Redis and optional Elasticsearch containers with retained data volumes |

```mermaid
flowchart LR
  Browser --> Web[Next.js :8000]
  Web -->|/api proxy| API[Express :4000]
  API --> Neon[(Neon PostgreSQL)]
  API --> Redis[(Docker Redis)]
  Worker[Separate worker process] --> Neon
  Worker --> Redis
  API --> Elasticsearch[(Docker Elasticsearch)]
  Worker --> Elasticsearch
  Worker --> Slack[Slack incoming webhook]
```

## Run locally

Prerequisites: Node.js 24.11 or later, pnpm 11.25.0, Docker with Linux containers and Compose, a Neon PostgreSQL database, and Google OAuth credentials. Full functionality also uses two Ethereal accounts, Elasticsearch, and a Slack app. Application and worker processes run on the host; Redis and Elasticsearch run in Docker.

### Environment configuration

Create `apps/api/.env` with your own values:

```dotenv
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:8000
DATABASE_URL="postgresql://USER:PASSWORD@NEON_POOLED_HOST/DATABASE?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@NEON_DIRECT_HOST/DATABASE?sslmode=require"
REDIS_URL=redis://127.0.0.1:6379
SESSION_SECRET=REPLACE_WITH_RANDOM_SECRET
CREDENTIAL_ENCRYPTION_KEY=REPLACE_WITH_32_BYTE_BASE64_KEY
ADMIN_EMAILS=admin@example.com
GOOGLE_CLIENT_ID=REPLACE_WITH_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=REPLACE_WITH_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
WORKER_CONCURRENCY=5
```

Copy Neon's pooled connection string to `DATABASE_URL` and its direct connection string to `DIRECT_URL`, targeting the same database and branch. Preserve the connection parameters provided by Neon. Generate two independent secret values with the following command, running it once for each secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep `CREDENTIAL_ENCRYPTION_KEY` stable so saved SMTP and Slack credentials remain decryptable. `ADMIN_EMAILS` is a comma-separated list; Bull Board additionally requires a Google-verified account.

Create `apps/web/.env.local`:

```dotenv
APP_URL=http://localhost:8000
API_INTERNAL_URL=http://127.0.0.1:4000
```

In Google Cloud, configure a Web application OAuth client and register exactly `http://localhost:8000/api/auth/google/callback`. Allow the login account in the consent screen's test audience where applicable. The application requests `openid email profile`; Gmail sending permissions and app passwords are unnecessary.

Configure Elasticsearch using the [search setup](#search) below before starting the app. Slack's HTTPS configuration is described under [Slack](#slack). Environment and SMTP import files are ignored by Git; credentials stay on the backend.

### Start the application

From the repository root:

```sh
pnpm install
pnpm services:up
pnpm db:deploy
pnpm dev
```

In another terminal:

```sh
pnpm dev:worker
```

Open [localhost:8000](http://localhost:8000); signed-out users reach `/login`, and signed-in users reach `/dashboard`. Email/password signup is available at `/signup`. API checks are [health](http://localhost:8000/api/health) and [readiness](http://localhost:8000/api/ready). Google-verified admins in `ADMIN_EMAILS` can inspect [Bull Board](http://localhost:8000/api/admin/queues). On a fresh database, sign in and follow the sender import steps below before composing messages.

## SMTP sender setup

Create two separate Ethereal accounts and save their actual SMTP settings in ignored `apps/api/.ethereal-senders.local.json`. Use this structure for each account:

```json
[
  {
    "name": "Sender A",
    "email": "ACCOUNT_A@ethereal.email",
    "smtpHost": "smtp.ethereal.email",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "ACCOUNT_A@ethereal.email",
    "smtpPassword": "REPLACE_WITH_SMTP_PASSWORD"
  },
  {
    "name": "Sender B",
    "email": "ACCOUNT_B@ethereal.email",
    "smtpHost": "smtp.ethereal.email",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "ACCOUNT_B@ethereal.email",
    "smtpPassword": "REPLACE_WITH_SMTP_PASSWORD"
  }
]
```

After the intended owner has signed in, open a Node console from `apps/api`:

```sh
cd apps/api
node --import tsx --env-file=.env
```

Enter the following, replacing `owner@example.com` with that account's email:

```javascript
var { createDatabase } = await import("@repo/db");
var { createSendersService } =
  await import("./src/modules/senders/senders.service.ts");
var { readFile } = await import("node:fs/promises");
var database = createDatabase(process.env.DATABASE_URL);
var owner = await database.user.findUniqueOrThrow({
  where: { email: "owner@example.com" },
  select: { id: true },
});
var accounts = JSON.parse(
  await readFile(".ethereal-senders.local.json", "utf8"),
);
void (await createSendersService(
  database,
  process.env.CREDENTIAL_ENCRYPTION_KEY,
).import(owner.id, accounts));
await database.$disconnect();
```

Exit with `.exit` and return to the repository root with `cd ../..`. The import validates and encrypts credentials. Reimporting the same SMTP host/account updates the existing sender; ordinary restarts need no reimport. Port 587 uses STARTTLS with `smtpSecure: false`.

## Compose and mailbox

Select a sender in Compose. The worker dispatches schedules and consumes due send jobs through Ethereal SMTP. Open a Sent row and select **View captured message** to inspect the result; messages addressed to Gmail or other real addresses remain captured by Ethereal.

The mailbox refreshes after actions, on request, and ten seconds after each completed poll. Scheduled includes pending, scheduled, processing, and retrying emails. Sent includes sent, failed, and uncertain outcomes. The filter menu exposes Inbox, Starred, Archived, and All mail, plus sender and status filters. Archive affects visibility without cancelling delivery. Delete cancels unsent work before SMTP begins; an in-progress SMTP attempt returns a conflict. Deleting a terminal email hides it while retaining its delivery history. Counts follow the view/sender filters and remain independent of the selected mailbox/status.

Open **Compose** or `/dashboard/compose` to select a sender, enter recipients, or import a UTF-8 CSV/text file up to 1 MB. A CSV `Email` header is recommended; quoted fields and a BOM are supported. Review the detected, duplicate, and invalid counts before adding valid recipients. Up to 5,000 unique addresses can be scheduled. Delay is entered in seconds (default 2); hourly limit defaults to the configured sender cap (200). Both use current server configuration rather than separate frontend limits. Send means eligible now, subject to sender gates. The clock menu accepts a future browser-local date/time or a tomorrow preset; Done selects it and Send Later schedules it.

The editor uses Tiptap for typography, formatting, alignment, line spacing, lists/indentation, quotes, rules, and undo/redo. The API sanitizes HTML and derives its plain-text alternative before persistence. SMTP sends both alternatives. A draft keeps the same idempotency key and exact payload when retrying an unconfirmed request without edits.

Attachments use ignored `apps/api/var/uploads/` with UUID filenames and PostgreSQL owner/size/hash metadata. Limits are 5 MB per file, 10 files, and 20 MB total per batch. Supported image signatures get an authenticated inline preview; other files download as attachments. Schedule atomically binds uploads to one batch, after which they are immutable. The worker verifies bytes against their SHA-256 hash before starting SMTP. Keep API and worker on this checkout and preserve uploads across restarts; backing up the database alone does not back up files. Abandoned uploads can remain after a browser crash; automatic retention cleanup is not implemented. A deployment across machines would require shared persistent storage.

Optional worker settings in `apps/api/.env` are `WORKER_CONCURRENCY=5`, `SMTP_TIMEOUT_MS=30000`, `MAX_SEND_ATTEMPTS=3`, and `SEND_RETRY_BASE_MS=5000`. Use consistent settings and the same `QUEUE_PREFIX` in every API/worker instance. A batch records its queue namespace, so unrelated test namespaces do not dispatch each other's emails.

Sender quotas count reserved attempts conservatively, including failed/uncertain attempts, in fixed UTC hours. A lower batch cap also applies. Redis Lua coordinates reservations and leases; PostgreSQL records durable attempt counts and spacing so a lost Redis cache cannot reset an allowance. Same-sender SMTP sessions are serialized; other senders can progress concurrently. Confirmed transient failures retry with backoff. An interrupted attempt after SMTP submission begins becomes `DELIVERY_UNCERTAIN` when its lease expires and is not blindly resent. SMTP acceptance and a database commit are separate operations; queue IDs and Message-ID do not guarantee exactly-once external delivery.

For a compiled run, use `pnpm build`, then `pnpm start:api`, `pnpm start:web`, and `pnpm start:worker` in separate terminals. Builds generate Prisma and compile shared packages before their consumers. Restart the dev command after changing a shared package.

## Search

Create root `.env.docker.local` with `ELASTIC_PASSWORD` set to a random password, then start the authenticated Elasticsearch container:

```sh
pnpm services:search
```

Using a local REST client, send `POST http://127.0.0.1:9200/_security/api_key` with Basic authentication (`elastic` and that password) and this JSON body:

```json
{
  "name": "email-scheduler-local",
  "role_descriptors": {
    "email_search": {
      "cluster": [],
      "indices": [
        {
          "names": ["email-scheduler-*"],
          "privileges": ["read", "write", "manage"]
        }
      ]
    }
  }
}
```

Put the response's `encoded` value in `apps/api/.env`:

```dotenv
ELASTICSEARCH_NODE=http://127.0.0.1:9200
ELASTICSEARCH_API_KEY=REPLACE_WITH_ENCODED_API_KEY
ELASTICSEARCH_INDEX=email-scheduler-v1
```

Restart the API and worker after updating their environment. The worker creates a missing index and backfills PostgreSQL records automatically. Preserve the bootstrap password with the existing Docker volume; editing the local file alone does not change an existing Elasticsearch password.

The search bar debounces input by 300 ms and keeps the query in the URL. It matches words across subject, plain body, recipient, and sender. Mailbox filters, counts, pagination, and detail navigation continue to work. PostgreSQL rechecks ownership and current visibility before returning any indexed IDs. New text is eventually consistent; an Elasticsearch outage shows a search-specific error while ordinary browsing, scheduling, and SMTP continue.

PostgreSQL triggers record revisions atomically with email/batch/sender changes. A separate BullMQ search worker projects them in bounded batches and retries outages. External versions and retained deletion markers prevent stale writes from restoring deleted content. Index-generation checkpoints allow recovery after index loss. Queries with more than 10,000 candidates ask for narrower terms. Local Elasticsearch uses one shard and no replicas; this setup does not provide high availability.

## Slack

Create a Slack app in the intended workspace, enable Incoming Webhooks, and add the `incoming-webhook` OAuth scope. Use an HTTPS application origin for authorization. For local development, a tunnel can forward that origin to port 8000.

Set `APP_URL` to the same HTTPS origin in both API and web environment files. Add these settings to `apps/api/.env`:

```dotenv
SLACK_CLIENT_ID=REPLACE_WITH_SLACK_CLIENT_ID
SLACK_CLIENT_SECRET=REPLACE_WITH_SLACK_CLIENT_SECRET
SLACK_REDIRECT_URI=https://YOUR_APP_HOST/api/integrations/slack/callback
GOOGLE_REDIRECT_URI=https://YOUR_APP_HOST/api/auth/google/callback
```

Register those exact callbacks in the Slack and Google app settings respectively. Keep `API_INTERNAL_URL=http://127.0.0.1:4000` for the local proxy. Restart the app/worker terminals and sign in through the HTTPS origin. When a tunnel hostname changes, update both `APP_URL` values and both providers' callbacks together.

The account menu's **Connect Slack** opens `/dashboard/settings`, where you authorize a workspace/channel, inspect the connection, disconnect, and reconnect. Slack alerts fire when either the sender's configured cap or a batch's UI hourly limit is reached. Batch alerts identify the subject, batch ID, limit, deferred count, and UTC reset; their counts include only that batch. Each batch can notify once per hour independently of earlier sender or batch alerts. If both limits are reached together, one sender alert includes both limits and covers that batch. The notification worker retries definite failures and retains confirmed state across restarts. Expired events are not replayed. An ambiguous external post is retained as uncertain without an automatic resend.

Saved Slack notifications continue without a tunnel. For localhost browsing, manually set API/web `APP_URL=http://localhost:8000` and API `GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback`, then restart. New Slack authorization requires the matching HTTPS configuration again.

## Validation and maintenance

```sh
pnpm build
pnpm check-types
pnpm lint
pnpm format:check
```

For a manual smoke check, sign in, import two senders, and schedule a small CSV batch. Inspect Scheduled, then Sent and the captured message. Check search, attachment downloads, and mailbox actions. Connect Slack and schedule three recipients with a batch limit of two while the sender has sufficient remaining capacity; verify a batch alert and a deferred recipient. Restart the API and worker with pending work and verify that it resumes without resending confirmed deliveries.

Use `pnpm db:migrate -- --name DESCRIPTIVE_NAME` when developing a schema change, then commit its migration. `pnpm db:deploy` creates the application schema on a fresh database or applies pending migrations to an existing database; `pnpm db:status` checks their history. Deployment does not create login accounts or import SMTP senders. The normal build generates the Prisma client.

Preserve applied migration names and SQL when making future changes. Database search triggers are part of the migrations and must be deployed alongside the tables.

Stop app terminals with Ctrl+C. `pnpm services:stop` stops local services and preserves their volumes. Elasticsearch runs behind the search Compose profile; start it with `pnpm services:search`. Redis and Elasticsearch bind only to localhost in this development configuration.
