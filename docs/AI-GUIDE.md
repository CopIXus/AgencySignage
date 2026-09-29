# Agency Signage — guide for AI assistants and scripts

This document is served by the signage server at `/api/docs` (Markdown) and `/llms.txt`. A machine-readable summary of the same information is at `/api/schema`. Read this once, then work through the HTTP API.

## What this system is

Agency Signage is a small, local-only digital signage server, usually running on a Raspberry Pi in an agency building. It serves:

- **Screens**: pages that TVs open at `/screen/<slug>`. Each screen has a template, a display mode (pixel size), a draft, and a published version.
- **Datasets**: the rows behind a screen (award honorees, directory cards, or slides). Each screen that needs rows owns one dataset (`screen.datasetId`).
- **Media**: uploaded JPEG/PNG images referenced by id (`/media/<id>`).
- **Players**: displays that have opened a screen. The dashboard shows whether they are online and what version they have.

Content is edited as a **draft** and only appears on TVs after **publish**. Displays poll every 10 seconds and cache the last good page.

## Authentication

Two options:

1. **API token** (preferred for assistants). An admin creates one in the admin UI under *AI access*. Send it on every request:
   `Authorization: Bearer sig_...`
   Tokens have a role: `editor` (content, publish) or `admin` (also users, agency settings, backups, tokens).
2. **Session cookie**. `POST /api/login` with `{"username","password"}` returns a `signage_sid` cookie valid 12 hours.

The server uses a self-signed certificate on port 8443 (plain HTTP on 8080 redirects). Use `curl -k` or trust `/setup/ca.crt`. On the LAN the host is usually `https://signage.local:8443` or the Pi's IP.

Public (no auth) routes: `GET /api/public/screens/:slug`, `GET /api/public/agency`, `GET /api/docs`, `GET /api/schema`, `GET /media/:id`.

## Recommended workflow

1. `GET /api/schema` — confirm field names and the list of display mode ids.
2. `GET /api/screens` — see what exists. Do not create duplicates; edit in place.
3. `POST /api/screens` — create a screen with `name`, `template`, `modeId`, `turn`.
4. `GET /api/screens/:id` — fetch the full record including `draft`, `datasetId`, `presentation`.
5. Upload images with `POST /api/media/base64`, note the returned `id`.
6. `PUT /api/screens/:id` with the **whole** `draft` object (and `presentation` if changing it). The server replaces `draft` with what you send, so always send the complete object you got back, with your edits.
7. `PUT /api/datasets/:datasetId` with the **whole** `rows` array.
8. Check the rendered result: `GET /api/public/screens/:slug?preview=1` returns the payload the display renders from the draft. A human can look at `/screen/<slug>?preview=1` in a browser.
9. `POST /api/screens/:id/publish` when the user approves.

Always tell the user what you changed and which screens you published.

## Templates

### `award` — award board (honoree + previous recipients)

Draft:

```json
{
  "title": "Patrol Deputy of the Year",
  "current": { "name": "", "badgeNumber": "", "awardYear": "2025", "rank": "", "hireDate": "", "yearsOfService": "", "photoId": null },
  "branding": { ... },
  "layout": { ... }
}
```

Dataset kind `honorees`; rows: `{ "id", "name", "badgeNumber", "awardYear", "rank", "hireDate", "yearsOfService", "photoId" }`. Rows are sorted newest year first on the display. `POST /api/screens/:id/move-to-history` moves `current` into the dataset and clears it.

### `directory` — alphabetical cards (bonding companies, attorneys, services)

Draft: `{ "title": "Bonding Companies", "branding", "layout" }`.
Dataset kind `cards`; rows: `{ "id", "name", "subtitle", "phone", "address", "hours", "details", "logoId" }`. Cards sort by name. `logoId` shows a logo beside the name and in the tap-to-detail card. CSV import: `POST /api/datasets/:id/import` with `{ "csv": "name,subtitle,phone,address,hours,details\n...", "replace": false }`.

### `slides` — rotating announcements

Draft: `{ "branding", "layout" }`.
Dataset kind `slides`; rows: `{ "id", "title", "bodyHtml", "qrUrl", "qrLabel", "imageId", "durationSec", "days", "startTime", "endTime" }`.
`bodyHtml` is simple HTML (`<p>`, `<strong>`, `<br>`). `days` is an array of weekday numbers, Sunday = 0; empty means every day. `startTime`/`endTime` are `HH:MM` 24-hour in the agency timezone; blank means all day. `qrUrl` renders a QR code on the slide.

### `playlist` — rotate other screens

Draft: `{ "branding", "layout", "entries": [ { "id", "screenId", "durationSec", "days", "startTime", "endTime" } ] }`. Only screens in the same aspect family (for example `9:16`) as the playlist play; others are skipped.

## Display modes and turn

`modeId` values come from `GET /api/modes` (examples: `fhd-portrait` 1080×1920, `fhd-landscape` 1920×1080, `uhd-landscape` 3840×2160). A custom size is `"mode": { "width": 1280, "height": 1024 }`. `turn` (`none`, `clockwise`, `counterclockwise`) says how to rotate when the TV is physically mounted the other way from the mode.

## Presentation (per screen)

```json
{
  "motion": "off|subtle|smooth",
  "listOverflow": "fit|slow-scroll",
  "scrollSecondsPerRow": 12,
  "showClock": false,
  "showWeather": false,
  "progress": false,
  "details": false,
  "detailsSeconds": 30,
  "burnIn": { "logo": false, "logoEveryMinutes": 30, "logoSeconds": 8, "logoMediaId": null, "tone": false, "toneEveryMinutes": 60, "toneFadeSeconds": 30, "toneHoldSeconds": 45 }
}
```

`details: true` turns on touch kiosk mode: tapping a card or the honoree opens a detail sheet that closes after `detailsSeconds`.

## Branding (inside `draft.branding`)

```json
{ "agencyName": "Agency", "sheriffLine": "Sheriff", "primary": "#0c2340", "accent": "#c4a35a", "ink": "#f4efe4", "plate": "#f3e6c4", "lightBg": "#f6f1e6", "lightInk": "#0c2340", "font": "sans|serif|rounded|mono", "badgeMediaId": null, "sealMediaId": null }
```

`primary` is the page background, `accent` the headings and lines, `plate` the card color. Keep contrast high; these are read from across a lobby.

## Layout (inside `draft.layout`) — background photo with floating panels

```json
{
  "enabled": true,
  "backgroundMediaId": "<media id or null>",
  "backgroundFit": "cover|contain",
  "dim": 35,
  "blur": 0,
  "sections": [
    { "id": "content", "kind": "content", "x": 5, "y": 8, "w": 62, "h": 84, "fill": "rgba(12,35,64,0.72)", "ink": "", "radius": 18, "padding": 3, "align": "left", "scroll": "auto", "font": 100, "border": "", "shadow": false },
    { "id": "s1", "kind": "clock", "x": 70, "y": 8, "w": 26, "h": 16, "showDate": true, "align": "center", "fill": "rgba(0,0,0,0.4)", "radius": 18, "padding": 2, "font": 100 },
    { "id": "s2", "kind": "text", "x": 70, "y": 28, "w": 26, "h": 64, "title": "Visitors", "body": "Check in at the front desk.\nPhotos are not permitted.", "fill": "rgba(12,35,64,0.72)", "radius": 18, "padding": 3, "font": 100 },
    { "id": "s3", "kind": "image", "x": 2, "y": 2, "w": 12, "h": 10, "mediaId": "<media id>", "fit": "contain", "fill": "transparent" }
  ]
}
```

- Positions and sizes are **percent of the screen**, so the same layout works on any mode. Later sections draw on top of earlier ones.
- Exactly one `content` section is normal; it is where the template (award board, cards, slides) renders. With `scroll: "auto"` the panel scrolls slowly when the data is taller than the box; `fit` shrinks text; `clip` cuts off.
- `text` panels: `title` and `body` (plain text, newlines allowed). `image` panels: `mediaId` and `fit`. `clock` panels: `showDate`.
- `fill` is any CSS color; use `rgba(...)` for translucency over the photo. `ink` overrides text color; blank inherits branding `ink`. `font` scales text in `text` and `clock` panels (percent).
- With `enabled: false` the template fills the whole screen and sections are ignored.

## Media

- `POST /api/media` multipart form: field `file` (JPEG/PNG under 15 MB), optional `folder` (`photos`, `logos`, `seals`, `backgrounds`).
- `POST /api/media/base64` JSON: `{ "filename": "smith.jpg", "mime": "image/jpeg", "folder": "photos", "data": "<base64>" }`. The `data` may include a `data:` URL prefix.
- Both return `{ "id", "filename", "mime", "bytes", ... }`. Reference the `id` in `photoId`, `logoId`, `imageId`, `backgroundMediaId`, `mediaId`, `sealMediaId`, `badgeMediaId`, `logoMediaId`.
- Keep the long side at 3840 px or less; EXIF metadata is stripped on upload.

## Other endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/me` | Who am I (token name and role). |
| GET | `/api/dashboard` | Screens with players, publishes, disk free, clock warning. |
| GET | `/api/screens` | Screen list (no drafts). |
| POST | `/api/screens` | `{ name, template, modeId, turn }`. |
| GET | `/api/screens/:id` | Full screen with `draft` and `published`. |
| PUT | `/api/screens/:id` | `{ name?, slug?, modeId? or mode?, turn?, presentation?, draft? }`. `draft` replaces the whole draft. |
| POST | `/api/screens/:id/publish` | Snapshot the draft; version increments. |
| POST | `/api/screens/:id/revert` | Draft becomes the published version. |
| POST | `/api/screens/:id/move-to-history` | Award only. |
| DELETE | `/api/screens/:id` | Remove a screen. Ask the user first. |
| GET | `/api/datasets` | All datasets with rows. |
| PUT | `/api/datasets/:id` | `{ name?, rows?, source?, sourceUrl?, intervalSec? }`. `source: "lan-http"` pulls JSON from a private LAN URL. |
| POST | `/api/datasets/:id/import` | CSV import into `cards`. |
| POST | `/api/datasets/:id/fetch` | Pull from the LAN source now. |
| GET | `/api/media` | Media list. |
| DELETE | `/api/media/:id` | Remove an image. |
| GET/PUT | `/api/agency` | `{ name, logoMediaId, theme, timezone, weatherLat, weatherLon }` (PUT is admin). |
| GET/PUT | `/api/override` | `{ active, title, body, screenId }` — interrupts every playlist. |
| GET | `/api/modes` | Display mode catalog. |
| GET | `/api/public/screens/:slug?preview=1` | Rendered draft payload (what the display draws). |
| GET/POST/DELETE | `/api/tokens` | Admin: list, create `{ name, role }`, revoke. |

## Example: build a bonding company directory

```bash
H='Authorization: Bearer sig_...'; B='https://signage.local:8443'
S=$(curl -sk -H "$H" -H 'content-type: application/json' -X POST $B/api/screens -d '{"name":"Bonding Companies","template":"directory","modeId":"fhd-landscape","turn":"none"}')
ID=$(echo "$S" | jq -r .id); DS=$(echo "$S" | jq -r .datasetId)
curl -sk -H "$H" -H 'content-type: application/json' -X PUT $B/api/datasets/$DS -d '{"rows":[
  {"id":"a1","name":"Acme Bail Bonds","phone":"(555) 010-0100","address":"12 Main St","hours":"24 hours","details":"Se habla español","logoId":null},
  {"id":"a2","name":"Liberty Bonding","phone":"(555) 010-0200","address":"40 Court Ave","hours":"Mon–Sat 8–8","details":"","logoId":null}]}'
FULL=$(curl -sk -H "$H" $B/api/screens/$ID)
DRAFT=$(echo "$FULL" | jq '.draft | .title="Bonding Companies" | .layout.enabled=true | .layout.dim=45')
curl -sk -H "$H" -H 'content-type: application/json' -X PUT $B/api/screens/$ID -d "{\"draft\":$DRAFT,\"presentation\":{\"details\":true,\"detailsSeconds\":20}}"
curl -sk -H "$H" -X POST $B/api/screens/$ID/publish -d '{}'
```

## Rules of thumb

- Read before you write: fetch the screen, modify the returned `draft`, send it back whole.
- Never invent media ids; upload first and use the id you receive.
- Keep names short; lobby TVs are read from a distance. Cards fit about 12–24 per landscape screen before the display switches to slow scrolling.
- Do not delete screens, media, or users unless the user explicitly asks.
- Publishing is visible to the public immediately. Confirm with the user before publishing unless they asked you to publish.
- The server is local-only; there is nothing to configure on the internet.
