# OmniChat

A cross-platform AI workspace for coding projects and chat, backed by your own OmniRoute gateway. Work on imported source copies or linked local folders, review AI file changes, and approve commands in an isolated Docker runner. This repository contains a Next.js web app, Expo native chat app, Electron shell, Fastify API, shared TypeScript packages, and PostgreSQL/Prisma storage.

Start with the [coding workspace guide](docs/CODING-WORKSPACE.md) for project imports, local folder authorization, change publication, and sandbox setup. Coding is available in the web app and Electron shell; the native mobile app currently supports chat.

The web workspace now includes an IDE-style activity rail, workspace/file tabs, CodeMirror editing, project search, resizable panels, and a command palette. See the [IDE guide and implementation report](docs/IDE-WORKSPACE.md) for shortcuts, changed files, dependencies and limitations.

The product uses real authenticated API requests. It has no demo providers, fabricated responses, or hard-coded conversation history. Test fixtures run only in test code. Model discovery is a catalogue, **not** a provider health guarantee.

## Run locally

Requirements: Node.js 22 or later, pnpm 10.30.3, Docker Desktop with Linux containers, and an OmniRoute installation reachable by the API.

```sh
corepack enable
pnpm install
node scripts/setup.mjs
```

Edit `.env`: set `OMNIROUTE_BASE_URL` and `OMNIROUTE_API_KEY`. The setup script generates a unique database password. If your local gateway deliberately permits keyless access, explicitly set `OMNIROUTE_ALLOW_NO_AUTH=true`; this option is restricted to local hostnames. Never put the gateway key in `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, or the Electron renderer.

```sh
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Open **http://localhost:3210** and create your own account. The local API runs on port **4010**, PostgreSQL on **55432**. These ports avoid common development defaults and can be changed in `.env`. No default user/password is installed. Registration is intended for a trusted deployment; restrict network access or implement an invitation policy before opening registration to the public.

For day-to-day start, restart and stop commands, in both Docker and host development modes, see [Starting and restarting](docs/RUNNING.md).

Keep PostgreSQL running between sessions for persistent history. Stop this stack with `docker compose down`; keep its named volume to retain data. Do not add `--volumes` unless you intend to erase the database and uploaded attachments.

## Applications and packages

| Location | Responsibility |
| --- | --- |
| `apps/web` | Coding projects, editor, change review, terminal, chat, models, media and settings |
| `apps/api` | Sessions, coding agent, linked folders, sandbox execution, storage and generation |
| `apps/mobile` | Expo native UI and SecureStore authentication |
| `apps/desktop` | Sandboxed Electron shell and narrow validated native bridge |
| `packages/omniroute` | Server-only discovery and protocol adapters |
| `packages/database` | Prisma schema, committed migrations, optional seed |
| `packages/core` | Incremental SSE, branch selection, context budgeting, exports |
| `packages/api-client` | Typed browser/native transport and stream cancellation |
| `packages/types` | Shared API contracts |
| `packages/ui` | Design tokens |
| `packages/config` | TypeScript configuration |

## Verification

```sh
pnpm typecheck
pnpm test
docker compose exec postgres createdb -U omnichat omnichat_test
pnpm db:test:migrate
pnpm test:integration
pnpm test:e2e
pnpm --filter @omnichat/mobile test
pnpm --filter @omnichat/desktop test
pnpm build
pnpm --filter @omnichat/mobile build
```

Unit and integration tests use a mocked gateway and never incur provider generation costs. Create `omnichat_test` once (skip `createdb` if it already exists), and set `TEST_DATABASE_URL` in `.env`; the integration command refuses to fall back to your application database. Install the browser test runtime once with `pnpm exec playwright install chromium --only-shell`. Web end-to-end tests mock API responses and are clearly separated from live operation. Read-only gateway discovery can be checked with `LIVE_OMNIROUTE_TESTS=true pnpm test:live` (PowerShell: set `$env:LIVE_OMNIROUTE_TESTS='true'` first). No generation is performed by that command.

See [verification results](docs/VERIFICATION.md) for what actually passed on this machine and any remaining limitations. A successful build is not a claim that every provider, native device, or installer has been validated.

## Deployment and platform builds

- [Starting, restarting and stopping](docs/RUNNING.md)
- [Docker and production deployment](docs/DEPLOYMENT.md)
- [Mobile and desktop development / packaging](docs/PLATFORMS.md)
- [Installed OmniRoute compatibility and unavailable features](docs/OMNIROUTE-COMPATIBILITY.md)
- [Architecture and implementation plan](docs/IMPLEMENTATION-PLAN.md)

Optional capabilities remain unavailable when the gateway does not advertise enough information or a verified adapter is not implemented. The UI explains this instead of accepting a request it cannot safely construct. No embeddings are required for document context: supported documents use bounded local text extraction.
