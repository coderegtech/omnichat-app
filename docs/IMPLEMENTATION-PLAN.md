# OmniChat implementation plan

## Inspection and compatibility

The supplied workspace is empty. The brief is the only attachment; no dashboard screenshot was supplied. On 2026-10-16 the local gateway at `http://127.0.0.1:20128/v1/models` returned 778 catalogue entries (182 image, 4 video, 592 without an explicit type). Catalogue presence is not an upstream health check. Docker and Node 24 are available. Installed gateway route documentation/source is inspected before implementing protocol adapters. No ordinary automated test may call a paid provider.

## Architecture

pnpm workspace, TypeScript throughout. Next.js serves the browser and Electron renderer; Expo provides native mobile UI. Fastify is the sole credential-bearing gateway to OmniRoute. PostgreSQL/Prisma stores users, hashed sessions, conversations, branches, messages, settings, uploads, usage, and generation jobs. Browser sessions use HttpOnly cookies and origin checks; mobile uses expiring bearer sessions in SecureStore. Ownership is checked on every resource. Mutating generation requests use a client request UUID and a database uniqueness constraint. Model metadata is nullable when absent; compatibility overrides are explicit, versioned configuration.

Shared packages: `types` contracts; `core` SSE parser/context selection/export helpers; `api-client` transport with cancellation; `ui` tokens; `omniroute` server-only adapters; `database` Prisma schema/migrations; `config` TypeScript defaults.

## Delivery sequence

1. Establish these contracts, workspace tooling, schema and session security.
2. Implement live discovery, streaming/nonstreaming chat, cancellation, durable partial output and conversation CRUD.
3. Build responsive web UI and native mobile chat; reuse web UI in a hardened Electron shell.
4. Add uploads/text extraction, branching, exports, preferences, discovery diagnostics, and capability-gated media adapters with persisted jobs where documented.
5. Validate with deterministic unit/integration tests and browser tests; run PostgreSQL migrations and production builds. Keep any live provider smoke test explicit and bounded.
6. Document startup, deployment, platform packaging, actual verification and remaining limitations.

## Shared API contract

All application paths start `/api`. Errors are `{error: {code: string, message: string}}`. Lists are `{items, nextCursor?}` unless specified. Dates are ISO strings. Browser requests use credentials/include; non-GET cookie requests must have an allowed Origin. Native authentication sends `client: "native"` in register/login and receives a bearer token. Cookies never expose the OmniRoute key.

- POST `/auth/register` `{name,email,password,client?}`; POST `/auth/login` `{email,password,client?}` => `{user,token?}`. GET `/auth/me` => `{user}`. POST `/auth/logout`.
- GET `/models` and POST `/models/refresh` => `ModelRegistry` in shared types. GET `/status` uses the same registry/connection information.
- GET `/conversations?q=&cursor=` => list; POST `/conversations` `{title?,modelId?}` => conversation; GET `/conversations/:id` => `{conversation,messages}`; PATCH `{title?,pinned?,folderId?,modelId?,systemPrompt?,temperature?,maxTokens?}`; DELETE.
- POST `/conversations/:id/messages` `{content,modelId,requestId,parentId?,attachmentIds?,regenerate?,stream?}` => SSE. POST `/conversations/:id/cancel` cancels active local generation. SSE uses `data: JSON\n\n` with `StreamEvent` union; never retries generation automatically. Branching uses parentId and message ancestry.
- GET `/conversations/:id/export?format=markdown|json`; GET/POST `/folders`; DELETE `/folders/:id`.
- GET/PATCH `/settings` => UserSettings. GET/POST `/attachments` (multipart `file`); GET `/attachments/:id/download`; DELETE `/attachments/:id`.
- POST `/generations` `{kind,modelId,prompt,options?,attachmentId?,requestId}` => GenerationJob; GET `/generations` => list; GET `/generations/:id` => job; POST `/generations/:id/cancel`.
- POST `/search` `{query,modelId?}` => `{results:[{title,url,snippet?}]}` only after real gateway search. Unsupported endpoints return 409 with an explanation.

## Availability policy

No mock conversations or fabricated model health appear in the product. Tests supply isolated fixtures. Unknown capability is visibly unknown; optional features remain disabled unless endpoint schema and model compatibility are established. A successful models request proves gateway reachability only. Media adapters must validate inputs against advertised options; undocumented async status formats stay disabled. Local document extraction works without embeddings.
