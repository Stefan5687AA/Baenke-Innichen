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
- Admin mode:
  - click map to create bench
  - click marker to edit bench

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

## 5) Run locally

Terminal A (frontend):

```bash
npm run dev
```

Terminal B (worker API):

```bash
npm run worker:dev
```

If frontend and API run on different origins in local dev, set up a simple proxy or update fetch URLs in `public/app.js`.

## 6) Deploy API Worker

```bash
npm run worker:deploy
```

After deploy, note your Worker URL (example: `https://innichen-benches-api.<subdomain>.workers.dev`).

## 7) Deploy frontend to Cloudflare Pages

1. Push this repository to GitHub.
2. In Cloudflare Dashboard, create a new **Pages** project from this repo.
3. Build command: *(none)*
4. Build output directory: `public`
5. Deploy.

## 8) Connect Pages frontend to Worker API

Pick one:

- **Simple**: edit `fetch('/api/benches')` in `public/app.js` to your Worker URL.
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

## Notes

- This app is intentionally minimal and prompt-driven for admin editing.
- Add authentication before using in non-internal contexts.
