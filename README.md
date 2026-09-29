# Agency Signage

A local signage server for a Raspberry Pi on the internal network. The Pi holds the pages, photos, and accounts. Displays open a screen URL and never call the public internet themselves. Weather is the one optional outbound request, and the Pi makes it. If that request fails, the weather is left off the sign.

![One Pi on the local network serves the admin and every display](docs/how-it-works.svg)

## Install on the Pi

![Install command, choose a password, open admin, then set up each display](docs/install-flow.svg)

On the Raspberry Pi that will host the signs, run:

```bash
curl -fsSL https://raw.githubusercontent.com/CopIXus/AgencySignage/main/deploy/install.sh | sudo bash
```

The installer downloads the app, installs Node, and starts it at boot. The first time through, it asks you to choose the `admin` password. Type it twice. It must be at least 8 characters. That password creates the account and is not saved in the service file. Later updates with the same command leave the database, photos, and password in place.

Then open `https://signage.local:8443/admin` and sign in as `admin`.

## What a screen does

![A draft stays off the displays until publish. Tablets can open a card and return on a timer.](docs/screen-flow.svg)

## First start on a computer you already cloned

```bash
node server/index.js
```

The process listens on HTTPS port **8443** and redirects HTTP port **8080** to it. If you did not set a password during install, the first launch creates an administrator named `admin`, prints a password, and saves it in `data/initial-password.txt`.

Open `https://localhost:8443/admin`.

Trust the local certificate once so the browser stops warning: download `https://localhost:8443/setup/ca.crt` and install it as a trusted root. Kiosk installers do this for the display device.

## The admin

![Dashboard with live thumbnails of every screen, display status, and recent publishes](docs/admin-dashboard.png)

The admin is a dark operations console with a sidebar, metric cards, and a live thumbnail of every screen so you can tell them apart at a glance. Each thumbnail is the real display page, scaled down. Settings lets you set the agency name and logo for the sidebar and pick a light or dark theme.

## What you can edit

- Award boards, with an officer photo on the current honoree and on previous recipients, history that either fits or scrolls slowly, and a control that moves the current honoree into history.
- Card directories that stay alphabetical, with a logo, phone, address, hours, and notes on each card. CSV import is built in.
- Rotating slides with text, a photo, a QR code, and optional day and time windows.
- Playlists of those screens, with a quiet countdown, a nightly-safe loop, and one priority override.
- Clock and weather on each screen. Weather hides when it cannot be refreshed.

The editor shows the same page the TV renders, with tabs for **Content**, **Layout**, **Look**, **Display**, and **Publish**. Click a heading in the preview to edit it in place. Choose photos and logos from the media picker; upload from there too.

### Layout mode: photo background with floating panels

![Editor in layout mode: content panel, clock, and a notice panel over the page](docs/editor-layout.png)

Turn on **Layout** for a screen to put a photo behind it and place panels over the top. Panels are positioned in percent of the screen, so the same layout works on any TV size. Drag a panel in the preview to move it; pull the corner to resize. Panel kinds:

- **Template content**: the award board, directory cards, or slides. When the data is taller than the panel it scrolls slowly, or you can shrink it to fit.
- **Text**: a heading and paragraph you write yourself.
- **Photo or logo**: one uploaded image, fitted in the box.
- **Clock**: large time with the date.

Each panel has its own color, opacity, corner radius, padding, text size, alignment, border, and shadow. Presets give you a starting point. **Look** offers palettes and type styles per screen.

![The published directory on a 1080p TV in layout mode](docs/display-layout.png)

The dashboard shows whether each named display is in use, how many times the page has loaded, whether it is on the published version, and whether the resolution matches.

On a tablet, turn on **Tap a card to open details** for that screen. A tap opens the full card with its photo or logo, and the board returns on its own after the number of seconds you set. Touching the detail keeps it open a little longer. Lobby TVs can leave this off.

## Let an AI assistant build pages

Under **AI access** an admin creates an API token. Give your assistant the token, the server address, and the guide at `/api/docs` (also `/llms.txt`), and it can create screens, fill in rows, upload photos, lay out panels, and publish over the local API. `/api/schema` is the machine-readable version. Tokens can be revoked at any time, and everything stays on your network.

Requests carry `Authorization: Bearer sig_...`. The guide lives in this repo at [docs/AI-GUIDE.md](docs/AI-GUIDE.md).

## Raspberry Pi

The install command above installs Node, Avahi (`signage.local`), and a systemd service. The app code and the `data/` directory stay separate, so an update can replace the app and leave the database and media in place. From a checkout you already have, `sudo bash deploy/install-pi.sh` does the same thing.

Then open `https://signage.local:8443/setup` on each TV. Name the device, pick the screen and the panel mode (through 4K), and install. On the Pi that hosts the site, the page can run the installer. On another Pi or Linux PC, run the `curl | bash` command the page shows. On Windows, run the PowerShell script. Android TV cannot run that script; pin a kiosk browser to the screen URL instead.

The kiosk turns off screen blanking, restarts Chromium if it exits, and restarts it again at 3:00 by default. Leave kiosk mode for maintenance with Ctrl+Alt+F2, then:

```bash
systemctl --user stop agency-signage-kiosk.service
```

## Clock, backup, passwords

A Pi without a hardware clock forgets the time when power is lost. That throws off the lobby clock and the day/time windows. Point the Pi at the building’s time server, or fit a small hardware clock. The dashboard warns when the year looks wrong. Displays still do not call out themselves.

The service keeps the last seven daily copies of the database in `data/backups/`. An administrator can also download a zip of the database and media, and restore that zip from Settings.

Reset a lost password on the Pi:

```bash
node server/reset-password.js admin 'a-new-password'
```

## Development without HTTPS

```bash
npm run dev
```

That sets `SIGNAGE_INSECURE=1` and serves plain HTTP on port 8080 for a local check. The Pi install uses HTTPS. `node scripts/smoke.mjs <admin-password>` exercises the API end to end. There are no npm dependencies and no build step; the server uses Node 22 built-ins and the pages are plain JavaScript.
