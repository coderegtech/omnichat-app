# OmniRoute compatibility and deployment boundary

Inspected on 16 October 2026: the running local installation is **OmniRoute 3.8.51**. The process executable resolved to the installed `omniroute` npm package. Its `dist/docs/openapi.yaml` declares version 3.8.51. No credential database, endpoint key, environment dump, or provider token was read.

The installed documentation lists `/api/v1/...` routes; the running gateway exposes the public `/v1/...` aliases. `OMNIROUTE_BASE_URL` includes `/v1` and the adapter appends endpoint paths once. The local model catalogue returned 778 entries during the initial inspection; catalogue membership is not a provider health check.

## Verified protocol contracts

| Capability | Installed source inspected | Application behavior |
| --- | --- | --- |
| Models | OpenAPI `/api/v1/models`, `components.schemas.Model` | Authenticated application endpoint, server-side Bearer gateway authentication, 60-second cache, manual refresh. Missing context, pricing and capabilities stay unknown. |
| Chat | OpenAPI `/api/v1/chat/completions` and `ChatCompletionRequest` / `ChatCompletionResponse` | Sends `{model,messages,stream}`. Incremental OpenAI SSE `choices[0].delta.content` and `[DONE]`; supports JSON `choices[0].message.content`. Exposes only returned token counts. Reasoning fields are not displayed. |
| Images | OpenAPI `/api/v1/images/generations`; `open-sse/handlers/imageGeneration.ts` | Sends `{model,prompt,n:1}` and only advertised size options. Reads synchronous `data[].url` or `data[].b64_json`. Persists application job state and assets; no automatic retry. |
| Search | OpenAPI GET/POST `/api/v1/search`; `open-sse/handlers/search.ts` | GET discovers configured providers supporting `web`. POST sends `{query,max_results:5,search_type:"web"}` and reads normalized `results[].title/url/snippet`. Search is enabled only after provider discovery. |
| Other endpoints | Installed catalogue and dashboard categories | Disabled in application status. No fabricated video/music progress or unsupported async status polling. Responses/Messages/legacy chat are not exposed separately: conversation traffic uses the documented compatible chat endpoint. |

`GET /v1/models` and `GET /v1/search` are discovery calls; ordinary tests never call paid provider generation or search. The image and search adapters have deterministic fixtures; they have not been live-tested against a paid provider.

## Metadata and compatibility overrides

The v3.8.51 catalogue contains untyped entries for its ordinary chat registry. The application classifies an entry with no `type` as eligible for chat and explicitly marks `metadataSource: "compatibility"`. Typed image/video/etc. entries are not classified as chat. This version-specific rule is a routing eligibility hint, not a claim that the upstream account is healthy.

Explicit `capabilities` booleans, `capabilities.tool_calling`, `input_modalities`, `output_modalities`, `context_length` / `context_window`, `max_output_tokens`, `supported_sizes`, and `pricing` are read when supplied. Image input modality establishes vision support. No streaming, vision, temperature, reasoning, context limit, price, or provider health is invented. Chat attempts streaming unless the user disables it or the model explicitly says it does not support it; a JSON response is accepted without retrying a generation.

To add reviewed model knowledge independently of code, set `OMNIROUTE_COMPATIBILITY_FILE` to an operator-owned JSON file mapping **exact model IDs** to `Partial<Model>` records. Example schema (replace the ID with an actual configured model and only populate independently verified values):

```json
{
  "provider/exact-model-id": {
    "protocol": "openai-chat",
    "capabilities": { "chat": true, "vision": true, "streaming": true },
    "contextWindow": 32000,
    "maxOutputTokens": 4096
  }
}
```

Overrides are marked `metadataSource: "compatibility"`; health still remains unknown. Review the installed gateway version and provider documentation before enabling additional adapters. The shipped application does not automatically probe every model.

## Security and persistence

- Gateway keys stay in the API process. Discovery also requires an OmniChat session. Optional unauthenticated gateway access must be explicitly enabled with `OMNIROUTE_ALLOW_NO_AUTH=true` and is limited to localhost, loopback, or `host.docker.internal`.
- Passwords use scrypt with N=32768, r=8, p=1, random 16-byte salts and 64-byte derived keys. Sessions use 32 random bytes and store only SHA-256 digests. Browser sessions are HttpOnly, SameSite=Lax cookies; production always requires Secure cookies and HTTPS. Native sessions are returned only for `client:"native"` and belong in platform secure storage.
- Cookie mutations require an exact `WEB_ORIGINS` match, including login. Native clients may use valid Bearer sessions without Origin. An explicitly disallowed Origin is rejected even with a Bearer header. Every conversation, folder, message parent, attachment and job is checked against the authenticated user.
- Generation request IDs have database uniqueness constraints. A PostgreSQL advisory transaction lock serializes a conversation's generation claims. Repeating a completed request returns the saved message instead of spending again.
- Partial chat text is checkpointed at most every 500 ms of incoming chunks and persisted on normal completion, cancellation or failure. Client disconnect aborts the upstream request. A network failure after an upstream provider accepts work is never automatically retried; the provider may still charge.
- Context selection follows only the selected message ancestry. Conservative character budgets trim old turns; this is not claimed to be an exact tokenizer. Long extracted documents contribute their first 12,000 characters, with a notice. Image input requires confirmed vision metadata. Unknown context windows use a 48,000-character application ceiling.
- Uploads are limited to 10 MB, stored with random names outside the web root, and served only through authenticated ownership checks. Image/PDF signatures and text extensions are checked. PDFs use text extraction, not OCR; scanned and encrypted PDFs may require text exports. Deleting an attachment removes its stored bytes and associations.
- Conversations use soft deletion. User sessions expire; expired sessions are purged on server startup. Logs omit auth headers/cookies and sensitive body contents. Audit rows record registration, login and conversation deletion without credentials.

## Operational limits

The supplied deployment supports **one API replica**. Startup marks interrupted streaming messages and queued/running media jobs as failed while retaining saved text. This avoids unintentional billing retries. A distributed worker queue and leases would be required before scaling media processing across replicas. No upstream cancellation acknowledgement or refund is promised.

Jobs store HTTPS image URLs or bounded image data URLs. Upstream HTTPS URLs may expire; this version does not download arbitrary remote assets into durable object storage. Local storage requires a persistent mounted upload volume and backups alongside PostgreSQL. Database backup retention, account recovery/email verification, OAuth, malware scanning, OCR, RAG, durable remote asset archival and distributed job orchestration are deployment extensions, not completed features.

The production API runs TypeScript with `tsx` because shared workspace packages export TypeScript source; `build` performs a strict type check. Tests use isolated PostgreSQL when `TEST_DATABASE_URL` is explicitly supplied and mock all gateway inference responses. Without that variable, DB integration tests are reported as skipped. Unit tests remain offline.
