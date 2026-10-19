# IDE redesign audit and preservation plan

This audit was recorded on 18 October 2026 before the IDE layout changes. It describes the existing OmniChat implementation and the contracts that the redesign must preserve. The target is an OmniRoute-powered coding workspace using familiar IDE interactions, within this repository and its existing API.

## Existing architecture

The repository is a pnpm TypeScript monorepo. The web application uses Next.js 15, React 19, Zustand for client state, TanStack Query for server state, Radix dialogs and menus, Lucide icons, and CSS theme variables. Tailwind's stylesheet is imported, but most existing presentation is component classes and ordinary CSS. Motion supplies restrained message transitions. The application supports dark, light, and system themes, animation preferences, and reduced motion.

| Location | Existing responsibility | Preservation or extension approach |
| --- | --- | --- |
| `apps/web/app/page.tsx`, `layout.tsx` | Single application route and providers | Preserve the current entry point and API proxy configuration. |
| `apps/web/components/omnichat.tsx` | Shell, workspace navigation, authentication, history, folders, model selector, account and conversation controls | Refactor the shell around these real actions; retain routes, query keys, exports, and authentication behavior. |
| `apps/web/lib/store.ts` | Active workspace, conversation, model, mobile drawer | Extend the existing state solution for IDE navigation and layout instead of adding a second competing store. |
| `apps/web/components/chat.tsx` | Streamed conversation, branches, editing/regeneration, attachments, composer, Markdown | Preserve request and streaming behavior while improving presentation and draft lifecycle. |
| `apps/web/components/models.tsx` | Model discovery, capabilities, filtering, favorites, model picker | Reuse for title-bar selection and integration navigation. |
| `apps/web/components/coding-workspace.tsx` | Projects, file tree, source editing, AI proposals, task history, command approvals/output | Reuse source and task contracts; add real file tabs and a bottom panel without bypassing approvals. |
| `apps/web/components/local-folder-controls.tsx` | Assigned local roots, linking, exact publication preview, refresh | Preserve as a separate disk-publication workflow. |
| `apps/web/components/workspaces.tsx` | Media studios, connection information, live web search, uploaded files | Keep reachable through functional navigation or workspace tabs. |
| `apps/web/components/settings.tsx`, `auth.tsx` | User settings, conversation parameters, authentication | Retain existing dialogs and persistence. |
| `apps/web/components/ui.tsx` | Radix modal/menu wrappers, fields, selects, copy controls, branding | Reuse accessible primitives and OmniChat branding with explicit OmniRoute attribution. |
| `apps/web/app/globals.css`, `components/coding.css` | Theme tokens, shared controls, chat/studio/project layouts, breakpoints | Add cohesive IDE tokens and scoped layout rules; avoid accidental changes to dialogs and supporting workspaces. |
| `apps/api/src` | Fastify authenticated API, gateway requests, coding agent, linked folders, Docker execution | UI redesign must keep payloads and authorization boundaries intact. |
| `packages/types`, `api-client`, `core` | Shared contracts, streaming transport, source validation and context handling | Reuse existing types and validation rather than duplicating contracts in components. |
| `apps/desktop` | Electron shell with sandboxed renderer and narrow native bridge | Preserve external-link interception, native exports, and new-chat integration. |
| `apps/mobile` | Expo native chat interface | This web layout also appears in Electron; it does not by itself redesign the native app. |

The web application has a single `/` page and client-state navigation. No existing project or conversation URL deep-link scheme was found. Electron external links and exports remain separate integration concerns.

## Inherited verification baseline

The following results are historical records from [VERIFICATION.md](VERIFICATION.md), read during this audit. They were **not rerun by the audit** and are not evidence that the new IDE changes pass. Updated redesign results must be reported separately after implementation.

| Recorded date | Recorded check | Recorded result and limits |
| --- | --- | --- |
| 18 October 2026 | Unit tests | 48 passed; database and real Docker cases run separately. |
| 18 October 2026 | Full API suite with real Docker enabled | 42 passed against the isolated test database. Model responses remained mocked. |
| 18 October 2026 | Final coding-task regression | 9 passed after bounded command-output context was added. |
| 18 October 2026 | Chromium browser tests | 9 passed, covering five existing workspace journeys and four coding journeys. Browser APIs are fixtures. |
| 18 October 2026 | Production compilation | API TypeScript, optimized Next.js application, and Electron main/preload bundles passed. |
| 18 October 2026 | Linked folders and executor | Disposable filesystem tests, actual isolated Node execution, cancellation, and command-route idempotency passed. |
| 17 October 2026 | Earlier platform checks | Native component tests, native JavaScript exports, Electron security/smoke checks, unsigned Windows directory packaging, and Docker stack smoke checks were recorded. These predate coding and IDE additions. |

No live provider generation was performed in those records. Gateway discovery verifies a catalogue, not upstream provider health or coding quality. Earlier packaged applications and Docker images must not be described as containing the redesigned IDE until rebuilt and verified.

## Constraints and regression risks

**State and lifecycle.** The original shell conditionally mounts workspaces. Unmounting chat aborts its current stream. Changing conversations clears the draft and attachments. Coding editor drafts use an in-memory Zustand store, while selected project, file, run, and view are component state. A tabbed UI therefore needs deliberate state retention; visual tabs alone would lose context. Retain drafts by conversation and file, keep active operations valid during navigation, and clear user-owned client state on logout or account change. Persisting layout preferences does not require persisting source text or credentials in browser storage.

**Keyboard coordination.** Ctrl/Cmd+K originally creates a new chat. Ctrl/Cmd+S is handled by the coding editor. New shortcuts need one clear owner, active-workspace checks, and dialog/input awareness. Browser-owned shortcuts such as closing a browser tab must not be captured indiscriminately. Focus should return from dialogs and palettes to their invoking control.

**Layout and accessibility.** Existing global styles assume a wide sidebar and have several mobile overrides. A new activity rail, sidebar, tabs, and bottom panel must use bounded dimensions, `min-width: 0` and `min-height: 0` where appropriate, and independent scrolling. Resizing needs keyboard-operable separators and pointer cleanup. The mobile view should use drawers or compact controls instead of compressing every desktop pane. Existing Radix focus trapping, explicit labels, focus indicators, light themes, and reduced-motion behavior must survive.

**Source editing.** The existing editor is a textarea with line numbers; no editor library or language server is installed at baseline. A lightweight syntax-aware editor is appropriate only if it preserves selection, keyboard behavior, controlled values, accessible editing, and bounded file handling. Source snapshots contain at most 200 text files, 100 KiB per file, and 2 MiB total. Saving writes the server snapshot, not necessarily disk. Source-file language labels and cursor positions must be derived from actual file/content state.

**Search and unsupported tools.** Project detail already provides the bounded source snapshot, so current-project text search can use actual loaded files. Label the scope and handle empty/loading states. Existing web search is a different gateway capability and must remain available. There is no Git, PTY, debugger, language-server diagnostics, or extension-execution backend. Omit unsupported navigation or explain availability; do not invent branches, changed-file counts, terminals, or problems.

**Chat rendering.** Existing Markdown uses React Markdown, GFM, math, KaTeX, and syntax highlighting without rendering raw HTML. Reuse this pipeline and copy controls. Its original code-block label is generic; language names can be derived from the rendered `language-*` class. Preserve branch selection, optimistic message deduplication, cancellation, and capability-filtered model choice.

## API and security boundaries to preserve

| Workflow | Existing contract that must remain |
| --- | --- |
| Authentication and queries | Reuse `/auth/me`, existing login/logout/settings requests, server-side ownership checks, cookie-origin protection, and query-cache invalidation. Do not embed gateway credentials in renderer state. |
| Conversations | Preserve typed message streaming, request UUIDs, branches, parent IDs, attachments, cancellation, exports, folder organization, and conversation-specific settings. |
| Project source | `/projects/:id` returns project, source files, and runs. File save/delete uses `baseRevision`; stale edits must remain conflicts. |
| AI proposals | Starting a run does not apply source changes. Applying reviewed proposals validates revisions and file identities. Rejection and cancellation remain available. |
| Linked folders | Editor save and AI apply update a workspace snapshot. Publication requires the exact preview `version` plus explicit approval and checks external disk changes. Refresh warns before replacing saved and unsaved workspace edits. |
| Sandbox commands | Program/arguments are submitted with `approved: true` and `allowNetwork: false` only after approval. Existing execution is a bounded Docker job with recorded output, not an interactive host shell. |
| Command changes | Source files modified inside the sandbox are discarded. A terminal-looking panel must continue to explain that behavior and never imply disk persistence. |
| Unavailable capabilities | Respect model and endpoint discovery. Unsupported media, search, local roots, and executor states must remain disabled or explained. |

## Implementation and verification plan

1. Establish a compact title bar, persistent activity rail, contextual sidebar, central workspace, and status bar using the existing theme and components. Keep all supported application workspaces reachable.
2. Introduce shared layout and navigation state, real file tabs, and optional bottom tools. Preserve project selection and drafts across navigation. Keep model selection and authentication connected to their existing requests.
3. Integrate source editing, current-project search, task review, and command output. Maintain separate approval steps for applying source, executing commands, and publishing to local folders.
4. Add a command palette with only implemented actions and consolidate shortcuts. Provide active-tab semantics, meaningful labels, focus handling, and keyboard-operable resizing.
5. Verify desktop, tablet, and phone layouts, including long filenames, large code blocks, wrapped command output, narrow dialogs, theme changes, and collapsed panels.
6. Run type checking, unit tests, existing browser journeys, targeted new IDE journeys, and production compilation. Document any failing or unavailable check without treating fixture traffic as live model verification.

The most useful new browser regressions are: editor drafts survive file/project/workspace switches; chat drafts and active generation survive intended tab switches; dirty tab closure does not silently lose work; project search opens the actual result; palette keyboard actions dispatch once; sidebar and bottom panel resize, collapse, and reopen; logout clears prior-account content; and mobile layouts do not overflow. Existing coding tests must continue to prove that proposals, sandbox execution, and disk publication each require their own real user action.
