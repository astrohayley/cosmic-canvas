# Tests

End-to-end Puppeteer tests for the Cosmic Canvas gh-pages site, written against [Node's built-in `node:test`](https://nodejs.org/api/test.html).

## Setup

```bash
cd tests
npm install
```

The first install pulls Puppeteer (~200MB; it bundles its own Chromium). Subsequent runs reuse the cached browser.

## Run

```bash
npm test
```

A throwaway static server starts on an OS-assigned port, the tests exercise it through headless Chrome, then everything shuts down. No manual server setup required.

## What's covered

| Test | What it asserts |
|---|---|
| Page loads with jQuery and styled root | HTML + CSS + JS all load; `--color-header-bg` resolves through `.app` |
| Anonymous classification submits to Panoptes and returns 201 | `POST /api/classifications` body matches the Panoptes contract (annotations, metadata, links) |
| Brush strokes serialize to `{lines, width, height}` wire format | Drag produces a line with `points[]`, `brushColor`, `brushRadius`; undo empties |
| Sign-in builds authorize URL with `response_type=code` and configured client_id | Clicking "Sign in" redirects to `/oauth/authorize` with the right query params and exact `redirect_uri` |
| `?code` callback exchanges for a bearer (no client_secret) and authenticates classifications | Doorkeeper endpoints are intercepted; the bearer is persisted in `sessionStorage`, `?code` is scrubbed, the username renders in the header, and the next classification POST carries `Authorization: Bearer` |

The classify test hits **real Panoptes** so you'll see a 201 in your account's classification history. The OAuth callback test mocks the Doorkeeper endpoints so it runs entirely offline.

## File map

| File | Role |
|---|---|
| `e2e.test.mjs` | All five tests in one `node:test` file, sharing one browser instance |
| `server.mjs` | Tiny Node `http` static server for the three repo-root files |
| `package.json` | Single devDependency: `puppeteer` |
