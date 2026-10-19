# Deployment

## Local services and Docker

Copy `.env.example` via `node scripts/setup.mjs`, configure OmniRoute, and run:

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api web
```

Compose starts PostgreSQL, applies committed migrations in a one-off service, and starts the API and web only after their dependencies pass health checks. Database and attachment storage use named volumes. API/web containers run as a non-root user. Mobile and Electron development run on the host.

Compose binds published services to 127.0.0.1. Put a TLS reverse proxy in front of the web service for remote access. Set `WEB_ORIGINS` to the exact HTTPS origin and `COOKIE_SECURE=true`. Production always forces Secure cookies, even if the development template says false; remote HTTP login is therefore unsupported. Browsers may allow Secure cookies on localhost during local testing. Keep PostgreSQL inaccessible from the public network. The Next.js rewrite targets the private API service. `API_INTERNAL_URL` is a build-time rewrite target, so rebuild the web image if that target changes.

Production requirements include deployment-specific rate limits, restricted registration, backup/restore verification, monitoring, a trusted TLS proxy, signed desktop releases, and native device validation. OAuth, password-reset email, and a distributed generation worker are not configured. Do not describe an unsigned development package as a production release.

## Connecting containers to a Windows OmniRoute host

The default `DOCKER_OMNIROUTE_BASE_URL` is `http://host.docker.internal:20128/v1`. Docker Desktop supplies that hostname; Compose also adds a host-gateway entry for compatible Linux engines. **Host binding and firewall rules still matter.** A process listening only on 127.0.0.1 may not accept connections originating from a container. Verify without issuing a provider request:

```sh
docker compose exec api node -e "fetch(process.env.OMNIROUTE_BASE_URL+'/models',{headers:process.env.OMNIROUTE_API_KEY?{Authorization:'Bearer '+process.env.OMNIROUTE_API_KEY}:{}}).then(r=>console.log('models HTTP',r.status)).catch(e=>console.error(e.message))"
```

If unreachable, configure OmniRoute to listen on a private interface accepted by Docker and restrict the firewall to trusted clients, or use a reachable authenticated remote HTTPS endpoint. Do not disable your firewall or expose an unauthenticated gateway publicly. Running the API on the Windows host against `127.0.0.1` is another supported development setup.

## Secrets and authentication

Only the API receives the gateway endpoint key. Browser authentication uses HttpOnly, SameSite cookies; mutations validate the Origin. Mobile tokens live in the OS secure store and expire server-side. Session tokens are stored hashed. The Electron renderer has neither Node.js nor filesystem access. Its IPC bridge validates both sender and payload.

Use a password containing URL-safe characters for `POSTGRES_PASSWORD`, or URL-encode it in database URLs. The setup script generates hexadecimal secrets. Keep `.env` out of backups shared with other users. Do not log authorization headers, passwords, or uploaded document text. Use independent database credentials for production.

## Persistence, recovery and scaling

Back up the PostgreSQL database and attachments together. Exercise restoration into a separate environment. Schema changes must ship with a migration; apply with `pnpm db:migrate`. The optional development seed checks connectivity and does not install a default account.

This implementation runs one API process. In-process abort controllers and job execution require that model; do not run multiple replicas until cancellation and jobs are backed by a shared queue/lease system. Interrupted generation records are retained and reported with an error state. No automatic retry resubmits a provider generation request. A user can explicitly regenerate on a new branch.

Apply service memory, request body and upload limits appropriate to your environment. PDFs are parsed in the API process; for untrusted high-volume/public uploads, move extraction to a sandboxed worker with CPU and memory limits. Malware scanning and data-retention scheduling are deployment integrations, not claimed built-in services.

## Mobile networks

On a physical device, `localhost` refers to the device. Set `EXPO_PUBLIC_API_URL` to the API computer's LAN address or a trusted HTTPS hostname. Bind `API_HOST=0.0.0.0` only when LAN access is intended and limit firewall access. Android emulator commonly uses `10.0.2.2` for its host; iOS simulator can use the Mac host's localhost. Confirm reachability from the target device instead of assuming these mappings apply.

## Production commands

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm build
```

The API runs TypeScript with `tsx` because workspace packages share TypeScript source; its build runs a strict type check. The web is compiled by Next.js and the desktop main/preload by esbuild. See PLATFORMS.md for signing, store accounts, and OS-specific packaging.
