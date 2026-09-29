# Working on Agency Signage

Two audiences use this file: coding agents changing the project, and assistants operating a running signage server.

## Operating a running server (building pages, entering data)

Read `docs/AI-GUIDE.md` (also served live at `https://<host>:8443/api/docs`). Get an API token from an admin (admin UI → AI access) and call the HTTP API with `Authorization: Bearer <token>`. Fetch, edit the whole `draft`, send it back, check `/api/public/screens/<slug>?preview=1`, then publish when the user approves.

## Changing the code

- Zero dependencies: Node 22+ built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:zlib`). No npm packages, no build step. The client is vanilla JS ES modules served from `client/`.
- Layout: `server/index.js` (routes), `server/db.js` (SQLite schema and helpers), `server/payload.js` (what displays receive), `shared/runtime.js` (defaults shared by server and client), `client/display.js` + `client/src/stage.css` (the TV renderer), `client/admin.js` + `client/src/admin/admin.css` (admin app), `client/setup.js` (display enrollment), `deploy/` (installer and systemd unit), `docs/` (guide and diagrams).
- Run locally without HTTPS: `SIGNAGE_INSECURE=1 node server/index.js` then open `http://127.0.0.1:8080/admin`. First admin password is in `data/initial-password.txt` unless set at install.
- Smoke test: `node scripts/smoke.mjs`.
- Admin UI follows the dark console style in `admin.css` (`--bg-*`, `--accent`, `--cyan`, `.card`, `.btn`, `.form-field`, `.status-pill`, `.metric-card`). Reuse those classes instead of adding new one-off styles.
- Display rendering must work on a Raspberry Pi 4 in Chromium kiosk: prefer CSS transforms and simple DOM over heavy JavaScript; avoid external fonts and network calls.
- Anything that leaves the LAN is off by default; the only outbound call is optional weather.
- Do not mention or reference other projects in code, docs, or commits.
