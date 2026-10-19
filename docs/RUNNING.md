# Starting, restarting and stopping OmniChat

There are two ways to run OmniChat on your computer. Use **one at a time**: both use ports 3210 (web) and 4010 (API). If both run, the browser can show an old build or `pnpm dev` fails with `EADDRINUSE`.

| Mode | Use it for | Runs in Docker |
| --- | --- | --- |
| **Docker stack** | Everyday use, closest to production | Postgres, API, web |
| **Host development** | Editing code, **Local agent** on your folders, the command sandbox | Postgres only |

Run every command from the repository root. First-time setup (`pnpm install`, `node scripts/setup.mjs`, OmniRoute values in `.env`) is in the [README](../README.md#run-locally).

## Docker stack

Start, or rebuild after pulling or changing code:

```sh
docker compose up -d --build
```

Restart without rebuilding. Data is kept:

```sh
docker compose restart
```

Restart only one service:

```sh
docker compose restart api
```

Check status and logs:

```sh
docker compose ps
docker compose logs --tail=100 api web
```

Stop. Data is kept:

```sh
docker compose down
```

Open http://localhost:3210. Migrations run automatically on every `up`. The containerized API cannot see your local folders, so **Local agent** and linked folders need host development mode.

## Host development

Stop the Docker web and API first, but keep Postgres running:

```sh
docker compose stop web api
docker compose up -d postgres
```

Start the API and web with live reload:

```sh
pnpm dev
```

After pulling changes that add migrations, apply them before `pnpm dev`:

```sh
pnpm db:generate
pnpm db:migrate
```

To restart, press `Ctrl+C` in the `pnpm dev` terminal and run `pnpm dev` again. Restart after changing `.env`; the API reads it only at startup. Restarting also clears **Local agent** sessions, so bind the folder again afterwards.

To use **Local agent**, set these in `.env`, then restart:

```dotenv
CODING_LOCAL_PROJECTS='[{"email":"you@example.com","path":"C:/Projects"}]'
# Optional: allow approved npm/pnpm/yarn/npx/node commands in the bound folder
CODING_WORKSPACE_COMMANDS=true
```

To go back to the Docker stack, stop `pnpm dev` (`Ctrl+C`), then run `docker compose up -d`.

## Desktop app

The desktop app is a window onto the web app, so start one of the modes above first. Then, in PowerShell:

```powershell
$env:OMNICHAT_DESKTOP_URL = 'http://localhost:3210'
pnpm --filter @omnichat/desktop dev
```

After restarting the web app, press `Ctrl+R` in the desktop window to reload. Closing the window hides it to the tray. Use **Quit** from the tray menu to exit.

## Troubleshooting

**`EADDRINUSE` on 3210 or 4010.** Another copy is already running. Use `docker compose ps` to look for Docker services, and stop them with `docker compose stop web api`. For a leftover `pnpm dev`, find the process holding the port, check that it is OmniChat's Node process, then stop it:

```powershell
Get-NetTCPConnection -LocalPort 3210,4010 -State Listen | Select-Object LocalPort,OwningProcess
Stop-Process -Id <OwningProcess>
```

**Browser shows the old interface.** An old Docker container is answering on the port. Run `docker compose up -d --build`, or stop the containers if you are using host mode. Then hard-refresh with `Ctrl+Shift+R`.

**API exits with "table … does not exist".** Migrations are missing. Run `pnpm db:migrate`; Docker mode does this automatically.

**Models do not load.** Check `OMNIROUTE_BASE_URL` and `OMNIROUTE_API_KEY` in `.env`. Docker mode uses `DOCKER_OMNIROUTE_BASE_URL`. See [Deployment](DEPLOYMENT.md#connecting-containers-to-a-windows-omniroute-host).

## Erasing all data

Only do this to start completely fresh. This permanently deletes all accounts, conversations, projects and uploads:

```sh
docker compose down --volumes
docker compose up -d --build
```
