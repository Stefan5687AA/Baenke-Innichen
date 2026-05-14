# Innichen Bench Mapper

Minimal internal web app for mapping public benches in Innichen.

## Stack

- Plain HTML/CSS/JavaScript frontend (`public/`)
- Leaflet map rendering
- Cloudflare Worker REST API (`worker/`)
- Cloudflare D1 database (`schema.sql`)
- Cloudflare Pages for hosting frontend static files

## Features

- Map centered on Innichen
- Bench markers loaded from API
- Marker colors by status:
  - green = `ok`
  - yellow = `to_check`
  - red = `repair`
  - gray = `removed`
- Popup details per bench
- Admin-Modus mit festem Formular-Panel (unten, mittig):
  - Klick auf die Karte: temporärer Marker + "Bank hinzufügen"
  - Klick auf bestehenden Marker: Bearbeiten direkt im Popup (inkl. Position ändern und Löschen/Archivieren)
- Eigener Standort kann (nach Browser-Freigabe) als Marker auf der Karte angezeigt werden

## Project structure

- `public/index.html` – app shell
- `public/styles.css` – lightweight styling
- `public/app.js` – map logic + admin interactions
- `worker/src/index.js` – Worker API endpoints
- `worker/wrangler.toml` – Worker + D1 binding config
- `schema.sql` – D1 schema

## 1) Prerequisites

- Node.js 20+
- Cloudflare account
- Wrangler CLI (or use `npx wrangler`)

## 2) Install dependencies

```bash
npm install
```

## 3) Create D1 database

```bash
npx wrangler d1 create innichen-benches
```

Copy the returned database ID into `worker/wrangler.toml` (`database_id`).

## 4) Apply schema

Local:

```bash
npm run d1:migrate:local
```

Remote:

```bash
npm run d1:migrate:remote
```

Wenn du bereits eine lokale D1-Datenbank aus einem älteren Stand hast, führe zusätzlich diese Migration aus:

```bash
npm run d1:migrate:status:local
```

## 5) Run locally

Terminal A (frontend):

```bash
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:4173
```

Terminal B (worker API):

```bash
npm run worker:dev
```

Worker URL:

```text
http://127.0.0.1:8787
```

The frontend dev server is now the built-in Node script `scripts/serve-public.mjs`, so no extra `serve` package is required.
By default, this project auto-targets the current local hostname on port `8787` when opened on `localhost` or `127.0.0.1`.
You can override the API base with `window.__BENCH_API_BASE_URL` before `app.js` loads.

## 6) Deploy API Worker

```bash
npm run deploy
```

This deploys the Worker from `worker/wrangler.toml`. The live API URL should be `https://baenke-innichen.<subdomain>.workers.dev`.

## 7) Deploy frontend to Cloudflare Pages

1. Push this repository to GitHub.
2. In Cloudflare Dashboard, create a new **Pages** project from this repo.
3. Build command: *(none)*
4. Build output directory: `public`
5. Deploy.

## 8) Connect Pages frontend to Worker API

Pick one:

- **Simple**: set `window.__BENCH_API_BASE_URL` before loading `public/app.js` (or adapt `resolveApiBaseUrl()`).
- **Recommended**: configure a Pages redirect or Cloudflare route so `/api/*` points to the Worker.

## API overview

- `GET /api/benches` → active benches
- `GET /api/benches?active=all` → include inactive benches
- `POST /api/benches` → create bench
- `PUT /api/benches/:id` → update bench fields

Bench shape:

```json
{
  "id": 1,
  "title": "Town Hall Bench",
  "lat": 46.7329,
  "lng": 12.2822,
  "status": "ok",
  "last_inspection": "2026-04-10",
  "notes": "Repainted in spring",
  "active": true
}
```

## Trail poles

The app includes a second map area for trail sign poles (`Wandertafeln`). Use the toolbar switch to move between the bench map and the trail-pole map. The list button opens a bench list in the bench view and a pole list in the trail view.

Existing D1 databases need the additive trail-pole migration:

```bash
npx wrangler d1 execute innichen-benches --local --file=worker/migrations/005_add_trail_poles.sql --config worker/wrangler.toml
```

Use `--remote` for the remote D1 database.

Trail pole endpoints:

- `GET /api/trail-poles` -> active trail poles
- `GET /api/trail-poles?active=all` -> include inactive trail poles
- `GET /api/trail-poles/:id` -> one pole with all signboards and entries
- `POST /api/trail-poles` -> create pole with nested signboards and entries
- `PUT /api/trail-poles/:id` -> update pole fields; when `signboards` is sent, the pole's signboards are replaced
- `DELETE /api/trail-poles/:id` -> delete pole including signboards and entries

Trail pole shape:

```json
{
  "id": 1,
  "site_number": "12A",
  "lat": 46.7326,
  "lng": 12.2817,
  "active": true,
  "notes": "Optional note",
  "created_at": "2026-05-07 10:00:00",
  "updated_at": "2026-05-07 10:00:00",
  "signboards": [
    {
      "id": 1,
      "pole_id": 1,
      "direction": "Nord",
      "trail_number": "4",
      "sort_order": 0,
      "entries": [
        {
          "id": 1,
          "signboard_id": 1,
          "label": "Haunold",
          "duration": "45 min",
          "sort_order": 0
        }
      ]
    }
  ]
}
```

Trail pole validation:

- `site_number`, `lat`, and `lng` are required when creating a pole.
- Each signboard stores `direction`, `trail_number`, and `sort_order`.
- Each signboard must have 1 or 2 entries.
- Each entry requires `label`; `duration` is optional.
- Marker position always belongs to the pole.

## GitHub backups

The Worker cron runs once per night and writes the latest JSON snapshots to the configured backup branch.
The Worker also queues a backup whenever a new bench or trail pole is created.

Backup files:

- `backups/benches-latest.json` contains all benches and bench history.
- `backups/trail-poles-latest.json` contains all trail poles with nested signboards and entries.
- `backups/images/bench-images/*` contains uploaded photos up to 750 KB each.
- `backups/images/wanderbeschilderungen/*` contains uploaded trail sign photos up to 750 KB each.

New uploads are copied to the backup branch immediately after the R2 upload. Each scheduled or manual JSON backup also backfills up to 20 missing referenced images, so older photos are copied over gradually without making one backup run too large.

Manual backup endpoint:

```bash
curl -X POST https://<worker-url>/api/backups/github \
  -H "Content-Type: application/json" \
  -d "{\"confirm\":\"backup\"}"
```

Required Worker settings:

- `GITHUB_BACKUP_OWNER`
- `GITHUB_BACKUP_REPO`
- `GITHUB_BACKUP_BRANCH` (`data-backups` in `worker/wrangler.toml`)
- `GITHUB_BACKUP_DIRECTORY`
- secret `GITHUB_BACKUP_TOKEN`

Set the token with:

```bash
npx wrangler secret put GITHUB_BACKUP_TOKEN --config worker/wrangler.toml
```

## Notes

- Diese App ist absichtlich minimal gehalten und nutzt ein einfaches, formularbasiertes Admin-Panel.
- Add authentication before using in non-internal contexts.
