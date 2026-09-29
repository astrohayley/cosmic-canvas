// UI/UX parity tests — every test here corresponds to a feature that exists on
// the React `main` branch and should behave the same way on this gh-pages
// branch. If one of these fails, a user-facing behavior is missing or broken.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const VIEWPORT = { width: 1280, height: 900 };

let server, browser, baseUrl;

before(async () => {
  server = await startServer();
  baseUrl = server.url;
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function bootApp(extraPath = '', { clearStorage = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(baseUrl + extraPath, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (clearStorage) {
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  return page;
}

async function waitForClassifyReady(page) {
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 45_000 });
}

async function dismissTutorial(page) {
  await page.evaluate(() => { document.querySelector('.tutorial-close-button')?.click(); });
  await new Promise((r) => setTimeout(r, 200));
}

test('Quick Tutorial popup renders on first visit and dismisses on Close', async () => {
  const page = await bootApp();
  await page.waitForSelector('.tutorial-popup:not([hidden])', { timeout: 15_000 });

  const kicker = await page.$eval('.tutorial-popup-kicker', (el) => el.textContent.trim());
  assert.match(kicker, /quick tutorial/i);

  const steps = await page.$$eval('.tutorial-step-dot', (els) => els.length);
  assert.equal(steps, 4, 'tutorial should have 4 step dots');

  await page.click('#tutorial-close');
  await page.waitForSelector('.tutorial-popup[hidden]', { timeout: 5_000 });

  const seen = await page.evaluate(() => localStorage.getItem('cosmic-canvas:tutorial-seen:32203'));
  assert.equal(seen, 'true', 'closing the tutorial should persist the dismissal flag');
  await page.close();
});

test('Tutorial Next button advances and Finish closes the popup', async () => {
  const page = await bootApp();
  await page.waitForSelector('.tutorial-popup:not([hidden])', { timeout: 15_000 });

  for (let i = 0; i < 3; i++) {
    await page.click('#tutorial-next');
    await new Promise((r) => setTimeout(r, 100));
  }

  const lastLabel = await page.$eval('#tutorial-next', (el) => el.textContent.trim());
  assert.equal(lastLabel, 'Finish', 'last step Next button should say "Finish"');

  await page.click('#tutorial-next');
  await page.waitForSelector('.tutorial-popup[hidden]', { timeout: 5_000 });
  await page.close();
});

test('Subject shows three clickable image thumbnails', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  await page.waitForSelector('.image-thumbnails .thumbnail-btn', { timeout: 30_000 });
  const thumbs = await page.$$eval('.image-thumbnails .thumbnail-btn', (els) =>
    els.map((el) => ({ idx: el.getAttribute('data-image-index'), active: el.classList.contains('active') }))
  );
  assert.equal(thumbs.length, 3, 'subject should expose 3 image thumbnails');
  assert.equal(thumbs[0].active, true, 'first thumbnail should be active by default');

  await page.click('.image-thumbnails .thumbnail-btn[data-image-index="1"]');
  await new Promise((r) => setTimeout(r, 100));
  const activeAfter = await page.$eval(
    '.image-thumbnails .thumbnail-btn.active',
    (el) => el.getAttribute('data-image-index')
  );
  assert.equal(activeAfter, '1', 'clicking thumbnail #2 should mark it active');
  await page.close();
});

test('Brush controls: Brush/Eraser toggle, mode indicator, and Reset mask button exist', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  const labels = await page.$$eval('button', (els) => els.map((el) => el.textContent.trim()));
  assert.ok(labels.some((t) => /^brush$/i.test(t)), 'Brush button missing');
  assert.ok(labels.some((t) => /^eraser$/i.test(t)), 'Eraser button missing');
  assert.ok(labels.some((t) => /reset mask/i.test(t)), 'Reset mask button missing');

  const indicator = await page.$eval('#brush-mode-indicator', (el) => el.textContent.trim());
  assert.match(indicator, /mode: brush/i);
  await page.close();
});

test('Cursor preview circle paints on the overlay canvas while hovering', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  const box = await page.$eval('#brush-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  await page.mouse.move(box.cx, box.cy);
  await new Promise((r) => setTimeout(r, 50));

  const painted = await page.evaluate(() => {
    const el = document.querySelector('#brush-cursor-overlay');
    const ctx = el.getContext('2d');
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  assert.ok(painted > 100, `cursor overlay should be painted on hover, got ${painted} pixels`);
  await page.close();
});

test('Eraser cursor is white; Brush cursor is the brush color', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  const box = await page.$eval('#brush-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  const sampleOverlay = () => page.evaluate(() => {
    const el = document.querySelector('#brush-cursor-overlay');
    const ctx = el.getContext('2d');
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    }
    return n > 0 ? { r: r / n, g: g / n, b: b / n } : null;
  });

  await page.click('#brush-mode-eraser');
  await page.mouse.move(box.cx, box.cy);
  await new Promise((r) => setTimeout(r, 50));
  const eraser = await sampleOverlay();
  assert.ok(eraser.r > 200 && eraser.g > 200 && eraser.b > 200,
    `eraser cursor should be white-ish, got rgb(${eraser.r.toFixed(0)},${eraser.g.toFixed(0)},${eraser.b.toFixed(0)})`);

  await page.click('#brush-mode-brush');
  await page.mouse.move(box.cx + 0.5, box.cy);
  await new Promise((r) => setTimeout(r, 100));
  const brush = await sampleOverlay();
  assert.ok(brush.b > brush.r + 20,
    `brush cursor should be sky-blue (blue >> red), got rgb(${brush.r.toFixed(0)},${brush.g.toFixed(0)},${brush.b.toFixed(0)})`);
  await page.close();
});

test('Stroke smoothing is visible during the drag, not only after mouseup', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  const box = await page.$eval('#brush-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const points = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    points.push({
      x: box.x + 30 + (box.w - 60) * t,
      y: box.y + box.h / 2 + Math.sin(t * Math.PI * 3) * 60,
    });
  }

  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1, -5)) {
    await page.mouse.move(p.x, p.y);
  }

  const midDragPainted = await page.evaluate(() => {
    const el = document.querySelector('#brush-canvas');
    const ctx = el.getContext('2d');
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });

  for (const p of points.slice(-5)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();

  assert.ok(midDragPainted > 5000,
    `mid-drag canvas should already show the smoothed stroke (got ${midDragPainted} painted pixels)`);
  await page.close();
});

test('Eraser erases brush paint and reveals the subject image underneath', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);
  // Allow the seeded threshold mask to settle, then clear it for a clean canvas.
  await new Promise((r) => setTimeout(r, 1500));
  await page.click('#brush-clear');
  await new Promise((r) => setTimeout(r, 100));

  const box = await page.$eval('#brush-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.evaluate(() => {
    const el = document.querySelector('#brush-size');
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Horizontal brush stroke across the middle.
  const yMid = box.y + box.h / 2;
  await page.mouse.move(box.x + 30, yMid);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w - 30, yMid, { steps: 30 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 100));

  const sampleBlueExcess = (sx, sy) => page.evaluate((sx, sy) => {
    const el = document.querySelector('#brush-canvas');
    const ctx = el.getContext('2d');
    const rect = el.getBoundingClientRect();
    const cx = ((sx - rect.x) / rect.width) * el.width;
    const cy = ((sy - rect.y) / rect.height) * el.height;
    const data = ctx.getImageData(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5).data;
    let s = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { s += Math.max(0, data[i + 2] - data[i]); n++; }
    return s / n;
  }, sx, sy);

  const beforeErase = await sampleBlueExcess(box.x + box.w / 2, yMid);
  assert.ok(beforeErase > 30, `brush stroke should show clear blue signature at mid-canvas (got ${beforeErase.toFixed(1)})`);

  // Vertical eraser stripe through the brush stroke.
  await page.click('#brush-mode-eraser');
  await new Promise((r) => setTimeout(r, 100));
  const eraserX = box.x + box.w / 2;
  await page.mouse.move(eraserX, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(eraserX, box.y + box.h - 30, { steps: 30 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 100));

  const afterErase = await sampleBlueExcess(box.x + box.w / 2, yMid);
  assert.ok(afterErase < 40,
    `eraser should remove brush paint at the intersection (blue-excess was ${beforeErase.toFixed(1)} before, ${afterErase.toFixed(1)} after)`);
  await page.close();
});

test('OS arrow cursor stays visible (computed cursor is not "none")', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);
  const cursorCss = await page.$eval('#brush-canvas', (el) => getComputedStyle(el).cursor);
  assert.notEqual(cursorCss, 'none', `brush canvas computed cursor must not be 'none', got "${cursorCss}"`);
  await page.close();
});

test('View on Talk link styling matches main (background, border, z-index)', async () => {
  const page = await bootApp();
  await waitForClassifyReady(page);
  await dismissTutorial(page);

  const styles = await page.evaluate(() => {
    const el = document.querySelector('#subject-talk-link');
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      borderWidth: cs.borderWidth,
      borderColor: cs.borderColor,
      zIndex: cs.zIndex,
      height: cs.height,
    };
  });
  assert.match(styles.background, /rgba\(17,\s*19,\s*25,\s*0\.84\)/, `bg should be rgba(17,19,25,0.84), got "${styles.background}"`);
  assert.equal(styles.borderWidth, '1px');
  assert.match(styles.borderColor, /rgb\(58,\s*63,\s*71\)/);
  assert.equal(styles.zIndex, '2');
  // line-height: 0 cascading from .brush-canvas-stack would collapse the link to 0px height — this is the bug we fixed.
  const heightPx = parseFloat(styles.height);
  assert.ok(heightPx >= 12 && heightPx <= 20, `link height should be a normal text line (~14-15px), got "${styles.height}"`);
  await page.close();
});

test('OAuth implicit-grant failure (#error= in hash) surfaces a visible error banner with the redirect_uri hint', async () => {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Doorkeeper's implicit-grant failure returns the user to the redirect_uri
  // with #error=... in the fragment.
  const hash = new URLSearchParams({
    error: 'invalid_request',
    error_description: 'The redirect uri included is not valid.',
  }).toString();
  await page.goto(baseUrl + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('#auth-error-banner');
      return b && !b.hidden;
    },
    { timeout: 15_000 }
  );

  const banner = await page.$eval('#auth-error-banner', (el) => el.textContent || '');
  assert.match(banner, /sign-in failed/i);
  assert.match(banner, /redirect/i, 'banner should hint at redirect_uri registration as the likely cause');

  const authBtn = await page.$eval('#auth-button', (el) => el.textContent.trim());
  assert.match(authBtn, /sign in/i, 'auth button should stay "Sign in" after a failed callback');
  await page.close();
});
