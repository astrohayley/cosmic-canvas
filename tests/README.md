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
npm test               # both suites
npm run test:e2e       # contract: page load, classify POST, brush wire format, OAuth
npm run test:parity    # UI/UX parity with the React `main` branch
```

A throwaway static server starts on an OS-assigned port, the tests exercise it through headless Chrome, then everything shuts down. No manual server setup required.

## What's covered

### `e2e.test.mjs` — contract with Panoptes and OAuth

| Test | What it asserts |
|---|---|
| Page loads with jQuery and styled root | HTML + CSS + JS all load; `--color-header-bg` resolves through `.app` |
| Anonymous classification submits to Panoptes and returns 201 | `POST /api/classifications` body matches the Panoptes contract (annotations, metadata, links) |
| Brush strokes serialize to `{lines, width, height}` wire format | Drag produces a line with `points[]`, `brushColor`, `brushRadius`; undo empties |
| Sign-in builds authorize URL with `response_type=code` and configured client_id | Clicking "Sign in" redirects to `/oauth/authorize` with the right query params and exact `redirect_uri` |
| `?code` callback exchanges for a bearer (no client_secret) and authenticates classifications | Doorkeeper endpoints are intercepted; the bearer is persisted in `sessionStorage`, `?code` is scrubbed, the username renders in the header, and the next classification POST carries `Authorization: Bearer` |

The anonymous-classify test hits **real Panoptes** so you'll see a 201 in your account's classification history. Everything else mocks Doorkeeper / Panoptes so it runs entirely offline.

### `parity.test.mjs` — feature parity with React `main`

Each test corresponds to a user-facing behavior that exists on `main` and should behave the same on `gh-pages`. A failure here means the static site is visibly out of step with the React version.

| Test | What it asserts |
|---|---|
| Quick Tutorial popup renders on first visit and dismisses on Close | Popup auto-opens on first visit, has 4 step dots, and Close persists `cosmic-canvas:tutorial-seen:<projectId>` in localStorage |
| Tutorial Next button advances and Finish closes the popup | After three Next clicks the button reads "Finish"; one more click hides the popup |
| Subject shows three clickable image thumbnails | `.image-thumbnails .thumbnail-btn` has 3 entries; clicking the second one marks it active |
| Brush controls: Brush/Eraser toggle, mode indicator, and Reset mask button exist | All three controls render and the mode indicator reads "Mode: Brush" |
| Cursor preview circle paints on the overlay canvas while hovering | Hovering over `#brush-canvas` paints >100 pixels on `#brush-cursor-overlay` |
| Eraser cursor is white; Brush cursor is the brush color | In Eraser mode the overlay's average color is white-ish; switching back to Brush, the average is sky-blue dominated |
| Stroke smoothing is visible during the drag, not only after mouseup | Mid-drag canvas already shows >5000 painted pixels (the quadratic-Bézier smoothed curve) |
| Eraser erases brush paint and reveals the subject image underneath | Brush stroke at center → sky-blue dominant. Eraser stripe through it → sky-blue signal drops to near zero (subject image is revealed). |
| OS arrow cursor stays visible | Computed `cursor` on `#brush-canvas` is not `none` |
| View on Talk link styling matches main | bg `rgba(17,19,25,0.84)`, 1px border `#3a3f47`, `z-index:2`, height 14px (catches the `line-height:0` collapse bug) |
| OAuth token-exchange failure surfaces a visible error banner with the redirect_uri hint | Mocked 401 → `#auth-error-banner` becomes visible, mentions "Sign-in failed" and "redirect" so the user knows to check the Doorkeeper redirect_uri |

## File map

| File | Role |
|---|---|
| `e2e.test.mjs` | Contract tests: page load, classify POST, brush wire format, OAuth |
| `parity.test.mjs` | Parity tests for tutorial, multi-image, brush/eraser, cursor preview, smoothing, Talk link |
| `server.mjs` | Tiny Node `http` static server for the three repo-root files |
| `package.json` | Single devDependency: `puppeteer` |
