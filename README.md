# Cosmic Canvas

A no-build Zooniverse brush-tool classifier. Three static files at the repo root, deployed to GitHub Pages.

Live: <https://astrohayley.github.io/cosmic-canvas/>

> The `main` branch hosts the React + Vite version. This `gh-pages` branch is a parallel rewrite as plain HTML + jQuery for GitHub Pages.

## Files

| File | Purpose |
|---|---|
| `index.html` | DOM shell + jQuery via CDN |
| `app.js` | Classify loop, brush canvas, OAuth |
| `styles.css` | Styling |
| `.nojekyll` | Disables Jekyll preprocessing on GitHub Pages |
| `tests/` | End-to-end Puppeteer tests (see `tests/README.md`) |

## Run locally

```bash
python3 -m http.server 3002
# or
npx http-server -p 3002 -c-1
```

Open <http://localhost:3002/>. URL params override config:

- `?project=32203` — Zooniverse project ID
- `?workflow=31480` — workflow ID (default: project's first active workflow)
- `?env=staging` — Panoptes environment

## Tests

End-to-end tests live in `tests/` and run with Node's built-in test runner against a self-starting static server:

```bash
cd tests && npm install
npm test
```

See [`tests/README.md`](tests/README.md) for the per-test breakdown.

## Deploy

GitHub Pages source: **Deploy from a branch** → `gh-pages` / `/`. No build step — the files in this branch ARE the deployed site.

## OAuth

Sign-in uses the Zooniverse Doorkeeper OAuth Authorization Code flow as a public client (no client secret). Redirect URI is the page itself; see `app.js` → `OAUTH`.

## Attribution

Forked from the [Zooniverse IFE Classifier Template](https://github.com/kieftrav/Zooniverse-IFE-April-2026-Workshop).
