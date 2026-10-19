# Mobile and desktop

Both clients use the same authenticated OmniChat API. The API alone receives the OmniRoute endpoint key. Never put that key in an Expo public variable, Electron configuration, or web bundle.

## Native mobile

The native client targets Expo SDK 55, React Native 0.83.10 and React 19.2.0. Versions are pinned using the [SDK 55 bundled native module manifest](https://github.com/expo/expo/blob/sdk-55/packages/expo/bundledNativeModules.json). It uses NativeWind, Reanimated/Moti, TanStack Query, Zustand, a virtualized message list, and Expo's streaming fetch implementation.

From the repository root, install dependencies and run the API/database described in README.md. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL` to the **API origin**, without `/api` at the end. This URL is public configuration, not a credential.

| Target | Example API origin | Requirements |
| --- | --- | --- |
| Android emulator | `http://10.0.2.2:4010` | Host API listening on a reachable interface; adjust the configured port |
| iOS simulator | `http://localhost:4010` | macOS/Xcode and local API |
| Physical phone | `https://api.example.com` | Reachable HTTPS backend; phone localhost refers to the phone |
| Local LAN device | `http://192.168.x.x:4010` | Development build, LAN connectivity, firewall access and platform network policy |

Production must use HTTPS. HTTP LAN traffic may require explicit development-only Android network security / iOS ATS settings; this repository does not weaken production transport rules. An HTTPS development tunnel to the API avoids those exceptions. Expo Metro's own tunnel does not automatically tunnel the API.

```powershell
pnpm --filter @omnichat/mobile doctor
pnpm --filter @omnichat/mobile android
# macOS only, after installing Xcode:
pnpm --filter @omnichat/mobile ios
# Start Metro for an already installed development client:
pnpm --filter @omnichat/mobile dev
```

Use a development client built from this repository. The installed Expo Go application may support a different SDK. SDK 55 uses React Native's new architecture. NativeWind setup follows the [official v4 installation guide](https://www.nativewind.dev/docs/getting-started/installation); dependency changes should be checked with `expo install --check` before creating a binary.

### Authentication and streaming

Login and registration send `client: "native"`. Expiring OmniChat bearer tokens are stored with [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/) and are never written to AsyncStorage or localStorage. In-memory authorization headers are attached only to the configured API. A 401 during restoration clears an expired token; transient network errors retain it and offer retry. Signing out first revokes the server session, then clears secure storage. The service must be reachable to complete revocation. The credential is device-bound on iOS; other platform storage behavior follows SecureStore.

Chat consumes `expo/fetch`'s streaming response body through the shared incremental SSE parser. AbortController and the server cancel endpoint stop generation. The app never automatically repeats a paid generation. Updates are batched at about 50 ms and unchanged message rows are memoized. History is persisted by PostgreSQL and reloaded from the API. Editing creates a branch, regeneration reuses the original user message, and the branch chooser returns to earlier responses. Unknown context sizes and model health are labeled unknown.

The implemented native workspace includes login/registration, persistent chat, streamed output/stop, branch navigation, model/provider search, model favorites/default, conversation search/pin/rename/delete, Markdown, message copy, uploads, OS sharing of Markdown/JSON exports, gateway status, dark/light/system themes, system instructions, animation/streaming preferences, safe areas, keyboard avoidance, haptics, and a swipe-accessible history sheet. Reduced-motion system settings are respected.

Native media studios, a folder-management UI, syntax highlighting, rendered LaTeX, per-conversation parameter controls, and conversation import are not implemented yet; use the web/desktop interface for its supported additional features. The native client does not fabricate disabled media capabilities or embed a browser as a substitute for native UI. Native history currently shows the first API page; use search for older records until pagination is added.

### Build and release

`pnpm --filter @omnichat/mobile build` exports the Android and iOS JavaScript bundles; it is **not** an APK, AAB, IPA or App Store release. Create native binaries with local platform tools above or an authenticated Expo EAS account:

```powershell
cd apps/mobile
pnpm exec eas build --profile preview --platform android
pnpm exec eas build --profile production --platform all
```

EAS CLI is an optional separately installed release tool. Set up the real EAS project, bundle/package identifiers and production HTTPS API environment before building. `eas.json` provides development, internal preview and production profiles but contains no fabricated account/project IDs or signing credentials. Apple distribution requires an Apple developer account and signing; Android distribution requires the release keystore and store account. Signing material belongs in release secrets. Native EAS builds and store submission are not performed by the source/bundle checks.

## Electron desktop

Electron reuses the deployed Next.js interface and its same-origin API proxy. Run the web service first. The desktop process does not run an embedded backend or bundle provider keys.

```powershell
$env:OMNICHAT_DESKTOP_URL = 'http://localhost:3210'
pnpm --filter @omnichat/desktop dev
```

Change the origin/port to the configured web URL. The locally validated development web port is 3210 where 3000 is occupied. Loopback HTTP is accepted only in development. Packaged applications require a credential-free HTTPS `OMNICHAT_DESKTOP_URL`, supplied by the operator's launch environment. An operator must choose and configure the production service before distributing installers; there is no invented production endpoint. The app is an online desktop client and requires that service.

The shell provides native window controls, a tray menu, `Ctrl/Cmd+N` for a new conversation, `Ctrl/Cmd+Shift+Space` to show the window, persistent visible window geometry, native save dialogs, notifications through a narrow bridge, and explicit launch-at-login preference support on packaged Windows/macOS builds. Shortcut registration can be unavailable if another app owns it. File selection and drag/drop use the browser's file APIs without exposing filesystem access. Closing hides to the tray when a tray is available; Quit exits the process. Linux launch-at-login is left to the desktop environment.

The preload exposes only `saveText`, `notify`, `setLaunchOnStartup`, `openExternal`, `onNewChat`, and the platform name. Main-process handlers check the exact main-frame sender and URL origin, validate payload types and lengths, restrict export size, and ask the native save dialog for a destination. Native downloads only accept same-origin URL chains and ask for a file destination. External HTTP(S) links require a native prompt before opening in the system browser. Arbitrary IPC, Node, shell, paths, and secrets are not exposed.

Context isolation, OS sandboxing and web security are enabled; Node integration, webviews, new windows and browser permission requests are disabled. Navigation/redirects stay on the configured origin. A restrictive CSP blocks frames, objects, cross-origin connections and production eval. Inline script/style allowances are retained for Next.js hydration; a nonce-bearing end-to-end CSP should replace these allowances before a deployment with stricter CSP requirements. Keep Electron updated in supported release lines; see [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

```powershell
pnpm --filter @omnichat/desktop build
pnpm --filter @omnichat/desktop package # unpacked application for the current host
pnpm --filter @omnichat/desktop dist    # platform installer targets
```

Electron Builder config contains Windows NSIS, macOS DMG/ZIP and Linux AppImage/DEB targets. Build and sign on each platform's CI runner; macOS notarization needs Apple credentials and Windows signing needs the publisher's certificate or trusted-signing service. Default icons and development identifiers should be replaced with approved release identity before distribution.

On a Windows development machine without symlink privileges, Electron Builder's signing helper extraction may fail even for an unsigned build. To verify an **unsigned application directory only**, run `pnpm exec electron-builder --dir --config.win.signAndEditExecutable=false` from `apps/desktop` after building it. This skips executable signing/resource editing and leaves the default executable metadata/icon; it does not relax the app's HTTPS, sandbox or IPC protections. The local verification used this override successfully. Keep normal signing enabled for releases and configure the signing-capable CI environment instead of distributing this development directory as a trusted release.

### Updates

Automatic update download/install is deliberately **not enabled** without a controlled publishing origin and actual publisher signing keys. Distribute verified signed installers using the operator's HTTPS release channel and install updates explicitly. Before adding an automatic updater, configure the real provider/channel, enforce signature verification, test rollback/downgrade policy, and test update installation on each OS. The source does not claim unsigned binaries are trusted or silently download executable updates. Code signing, notarization, installers and update delivery are release work not proven by a TypeScript build.

## Deterministic verification

```powershell
pnpm --filter @omnichat/mobile typecheck
pnpm --filter @omnichat/mobile test
pnpm --filter @omnichat/mobile build
pnpm --filter @omnichat/desktop typecheck
pnpm --filter @omnichat/desktop test
pnpm --filter @omnichat/desktop build
pnpm --filter @omnichat/desktop test:smoke
```

Native tests cover auth form validation/errors, native token issuance and secure persistence, expired versus offline session behavior, revocation order, branch isolation and preserving streamed partial text. The Electron unit tests cover URL/IPC/CSP restrictions. Its Playwright smoke starts an isolated local HTTP fixture, launches the built shell, checks that Node globals are absent, checks the minimal bridge and rejected export formats, and verifies blocked popup windows and sandbox status where reported by the OS. No test needs a provider account or sends paid generation requests.

Device/simulator validation is still required for keyboard layouts, platform accessibility, VoiceOver/TalkBack, file picker/share sheets, haptics, safe-area changes, interrupted/background streams and secure-storage persistence. Desktop release validation must cover tray behavior, global shortcuts, notifications, OS-native save dialogs, signed installers and updates on Windows/macOS/Linux. A JavaScript bundle export or DOM test is not proof of those native behaviors.
