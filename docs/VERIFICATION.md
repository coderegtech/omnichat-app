# Verification and delivery status

Verified on Windows with Docker Desktop, updated 19 October 2026. This is a functional implementation with local runtime verification, not a signed production release or a claim that every feature in the original brief is complete.

## IDE redesign verification — 19 October

| Command or check | Result and scope |
| --- | --- |
| Pre-redesign `pnpm test:e2e` | 9 passed, establishing the existing UI baseline before shell changes. |
| `pnpm --filter @omnichat/web typecheck` | Passed for the integrated shell, editor, panels and chat changes. |
| `pnpm test` | 52 passed; 32 database/real-Docker cases intentionally skipped by the unit-only command. Includes code-language rendering and account/conversation draft lifecycle tests. |
| `pnpm test:e2e` | 14 passed in Chromium. Existing nine workflows remain, with new quick-open/draft retention, source search/panel resizing, desktop/tablet layout, command palette, and sign-out cleanup cases. |
| Final `pnpm exec playwright test apps/web/e2e/coding.spec.ts` | All 7 coding cases passed after editor-width refinement and an added undo-history assertion across file-tab switches. |
| `pnpm build` | API TypeScript, optimized Next.js compilation and Electron bundles passed. A final web production build also passed after the retained-editor refinement. |
| Visual checks | Inspected the IDE test workspace at 1440px and verified bounded layouts at 1024px and 390px. Inspected live application navigation separately. The saved IDE screenshot contains clearly labelled browser-test fixtures. |

The initial post-redesign run had one UI failure: Next.js's development badge covered the rail Settings button. Disabling the development-only badge resolved it; the full 14-test suite then passed. No application feature was removed for the test.

No backend schema or request contract changed in this UI phase. The database and real Docker execution evidence below is from the preceding coding implementation; it was not rerun or represented as new live AI validation. No live provider generation was triggered. There is no separate lint script; the production Next.js build ran its configured lint/type-validation phase. Detailed changed files, dependencies and limitations are in the [IDE implementation report](IDE-WORKSPACE.md).

## Coding workspace verification — 18 October

| Check | Result and scope |
| --- | --- |
| Unit tests | 48 passed. Includes 17 source/path validation cases and 9 executor validation/isolation cases. Database and real Docker cases are skipped by the unit-only command and run separately below. |
| Full API suite with Docker enabled | 42 passed using the isolated PostgreSQL test database. Covers the existing API, coding tasks, local folder publication, command API, cryptography and Docker executor. |
| Final coding task regression | 9 passed after adding bounded command-output context, including a new assertion that recorded output reaches the next coding task. Model calls are mocked. |
| Browser tests | 9 passed: four coding cases plus five existing workspace cases. Covers review before apply, editor revisions, separate command approval, exact local publication version, phone layout, and the corrected streamed-message handoff. Browser API data is mocked. |
| Real Docker execution | A real Node test ran as an unprivileged container user without network, host mounts or forwarded API secrets. Cancellation retained partial output and removed the container. The actual HTTP command route and duplicate request ID behavior also passed. |
| Linked filesystem tests | Seven tests cover account roots, ownership, excluded sensitive files, exact publication review, create/delete, external conflicts, stale reviews, refresh, junction refusal and an uncertain database commit result. Only disposable test folders are used. |
| Database | Both coding-project and linked-folder Prisma migrations applied to application and test databases. |
| Production build | Updated API TypeScript, optimized Next.js application and Electron main/preload bundles compile successfully. |
| Live preview | Coding welcome inspected in the running web app. No demo project or generated provider output was inserted into the user account. |

Enable real executor tests explicitly with `TEST_CODING_DOCKER=1` before `pnpm test:integration`; the Docker image must already be pulled. Coding model calls in tests remain mocked, even when command execution uses real Docker.

Local folder linking is implemented but requires an operator-configured account/root entry. The standard Compose stack does not grant host folder or Docker socket access. Native Expo coding screens, unrestricted shell execution, Git workflows, and automatic dependency installation are not implemented. See [coding setup](CODING-WORKSPACE.md).

## Earlier platform checks — 17 October

These checks predate the coding workspace additions. The Docker images, unsigned Windows application directory and native exports below were not rebuilt as coding-feature release artifacts.

| Check | Result and scope |
| --- | --- |
| Workspace TypeScript | API, web, mobile, desktop and shared packages checked. The final web production build also validates its types. |
| Unit tests | 22 passed: incremental SSE parsing, branch/context handling, typed API transport, gateway normalization/capability detection, password/session security and web Markdown rendering. |
| PostgreSQL API tests | 16 passed, including 14 database-backed integration tests and 2 crypto tests. Uses a separate `omnichat_test` database. |
| Browser end-to-end tests | 5 passed in Chromium: authentication UI, streaming/history/regeneration, model switching/filtering, disabled media, saved light theme, mobile drawer and narrow layout. API responses are mocked. |
| Native component/state tests | 9 passed across authentication, secure sessions, branch state and Markdown message rendering. |
| Electron checks | 3 security tests and 1 launched-Electron smoke test passed. Checks include sandbox/Node isolation, bridge restrictions and blocked popups. |
| Windows packaging | Unsigned x64 application directory built successfully with executable signing/resource editing disabled for this development check. Uses the default Electron icon. This is not an installer or a signed release. |
| Production compilation | `pnpm build` passed: API TypeScript validation, optimized Next.js build and Electron main/preload bundles. |
| Native bundle export | Android and iOS Hermes bundle exports passed. These are JavaScript bundles, not signed native installers. |
| Database | Committed Prisma migration applied successfully to application and test databases on PostgreSQL 17. |
| Docker images and runtime | API, migration and web images built. Compose startup completed with PostgreSQL, API and web healthy, and migration exit status 0. Disposable-account integration passed through the production web proxy on separate localhost test ports. |
| Visual inspection | Web inspected at desktop and 390-pixel phone widths, with dark/light and responsive behavior also covered by browser tests. |

The API integration suite covers authenticated conversation persistence, streaming completion, cancellation, disconnect preservation, duplicate request rejection, branches, ownership, upload/download, image job lifecycle, search/export, import validation, cookie-origin protection, expired/revoked sessions, and foreign parent/attachment rejection. Generation fixtures are deterministic and never call a paid provider.

## Real local integration

The installed OmniRoute 3.8.51 gateway was inspected and queried at `http://127.0.0.1:20128/v1`. The host development smoke saw 766 catalogue entries; the subsequent Docker smoke saw 804. Both enabled chat, image generation and search. Counts can change; discovery does not prove upstream provider availability. Missing model metadata remains unknown.

A disposable account exercised the actual Next.js proxy, API, PostgreSQL persistence, conversation updates, attachment upload and authenticated download, followed by cleanup. All passed on both host development services and the built production Docker stack. Docker-to-host discovery succeeded through `host.docker.internal:20128` from both the PostgreSQL and API containers. Docker verification used web port 3211 and API port 4011 to avoid interrupting the development preview on 3210/4010; temporary API/web test containers were then stopped and PostgreSQL was retained.

**No live provider generation was executed.** Streaming, provider errors and generation jobs were verified against mocked gateway responses. Actual provider credentials, quotas, model access and output quality still require an intentional user generation. There are no fabricated live responses or demo conversations in the application.

## Remaining release and feature work

- Mobile is a native chat client with its own UI. Its media studios, folders UI, rendered LaTeX/syntax highlighting, conversation import, per-conversation parameter controls and history pagination remain unimplemented. See [platform details](PLATFORMS.md).
- Unsupported endpoints remain visibly disabled. Image edits, video, music, audio and other advanced adapters require verified request schemas and compatible models before activation. See the [compatibility matrix](OMNIROUTE-COMPATIBILITY.md).
- No APK/AAB/IPA, signed desktop installer, macOS notarization, app-store submission or secure update feed is delivered. Real release identities, hosting and signing credentials are required.
- Native devices and Windows/macOS/Linux release behavior still need manual validation, including accessibility, background streams, keyboard/safe-area behavior, pickers, notifications, tray, save dialogs and shortcuts. No 60 FPS performance certification or full accessibility audit is claimed.
- Public deployment still needs HTTPS, registration policy, password recovery if required, operational monitoring, backups/restore testing and upload extraction isolation. Jobs/cancellation currently require one API process.

## Dependency audit

The dependency audit was reduced from 18 advisories to 3 after compatible updates. At verification time, the audit reported no published patched versions for these remaining transitive dependencies:

| Package | Severity | Dependency path | Advisory |
| --- | --- | --- | --- |
| `node-forge` | High | Expo CLI | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `braces` | High | Metro / micromatch | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `sprintf-js` | Moderate | React Native Jest tooling | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

These findings are in native development/build/test dependency paths; this is not a claim that they are harmless. Recheck `pnpm audit` and update the affected toolchain before release. Do not expose development servers to untrusted networks or feed untrusted build/test inputs into affected tooling. Audit status is time-sensitive.

## Source archive

The source archive includes source, the pnpm lockfile, tests, migrations, CI, Docker configuration and setup documentation. It excludes credentials, `.env` files other than templates, databases, uploaded files, dependency directories, build caches and generated bundles. Run the README setup commands after extracting it. The local working checkout retains installed dependencies and development configuration for the preview.

The local unsigned Windows build is under `apps/desktop/release/win-unpacked`. The normal packaging command initially failed because Windows did not permit symlinks while extracting Electron Builder's signing helper. An explicit development-only `--config.win.signAndEditExecutable=false` override completed packaging without changing system privileges or the release signing configuration. Packaged mode still requires the operator's real HTTPS web origin.
