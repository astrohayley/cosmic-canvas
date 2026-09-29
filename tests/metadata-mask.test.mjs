/**
 * Subjects carry their machine mask as a `#mask_rle` metadata string. It is
 * decoded at the mask raster's size, rotated 90 degrees counterclockwise into
 * editor coordinates, and shown over the subject image. Subjects without the
 * field fall back to the luminance threshold.
 *
 * The fixture is a real production subject from subject set 138622.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';
import { decodeRLEMask, rotateMaskCounterClockwise, encodeRLEMask } from '../mask.js';

const VIEWPORT = { width: 1280, height: 900 };
const SHAPE = { height: 500, width: 500 };

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/subject-117414478.json', import.meta.url)), 'utf8'
));

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

function subjectPayload({ withMask }) {
  const metadata = { '!RA': '85.7334616', '#object_id': 'fixture' };
  if (withMask) metadata['#mask_rle'] = fixture.mask_rle;
  return {
    subjects: [{
      id: String(fixture.id),
      metadata,
      locations: fixture.locations,
      links: { project: '32203' },
    }],
  };
}

/** Serve one fixture subject in place of whatever the queue would return. */
async function openWithSubject({ withMask }) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  page._capturedErrors = errors;

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/subjects')) {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(subjectPayload({ withMask })),
      });
    }
    req.continue();
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  return page;
}

const readMask = () => Array.from(window.__cosmicCanvas.brush.mask);

test('a subject mask is decoded, rotated counterclockwise, and loaded', async () => {
  const page = await openWithSubject({ withMask: true });

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.equal(badge, 'Mask: metadata (loaded)');

  const actual = Uint8Array.from(await page.evaluate(readMask));
  const expected = rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE);

  assert.equal(actual.length, SHAPE.width * SHAPE.height);
  assert.deepEqual(actual, expected, 'the loaded mask must be the rotated decode of #mask_rle');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('the loaded mask overlays the galaxy, not a rotation of it', async () => {
  const page = await openWithSubject({ withMask: true });

  // The mask should sit over bright pixels of the subject image far more often
  // than an unrotated decode would. This is the alignment the volunteer sees.
  const overlap = await page.evaluate(() => {
    const { brush } = window.__cosmicCanvas;
    const { width, height } = brush.dimensions;

    // Re-read the subject image at mask resolution.
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const context = probe.getContext('2d');
    context.drawImage(brush.images[brush.images.length - 1].img, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);

    const bright = new Uint8Array(width * height);
    for (let index = 0; index < bright.length; index += 1) {
      const offset = index * 4;
      const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      bright[index] = luminance >= 128 ? 1 : 0;
    }

    let hits = 0, total = 0;
    for (let index = 0; index < brush.mask.length; index += 1) {
      if (!brush.mask[index]) continue;
      total += 1;
      if (bright[index]) hits += 1;
    }
    return { agreement: hits / total, total };
  });

  assert.ok(overlap.total > 1000, 'the fixture mask must cover a real region');

  // Discriminating check: the rotated mask must sit on the galaxy *better* than
  // the raw decode does. Without this comparison a brightness-shaped mask of any
  // orientation would pass.
  const unrotatedAgreement = await page.evaluate((rle) => {
    const { decodeRLEMask } = window.__cosmicCanvas.mask;
    const { brush } = window.__cosmicCanvas;
    const { width, height } = brush.dimensions;
    const raw = decodeRLEMask(rle, brush.dimensions);

    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const context = probe.getContext('2d');
    context.drawImage(brush.images[brush.images.length - 1].img, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);

    let hits = 0, total = 0;
    for (let index = 0; index < raw.length; index += 1) {
      if (!raw[index]) continue;
      total += 1;
      const offset = index * 4;
      const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      if (luminance >= 128) hits += 1;
    }
    return hits / total;
  }, fixture.mask_rle);

  assert.ok(
    overlap.agreement > unrotatedAgreement,
    `rotated agreement ${overlap.agreement.toFixed(3)} must beat unrotated ${unrotatedAgreement.toFixed(3)}`
  );

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('an untouched subject mask submits in editor orientation', async () => {
  const page = await openWithSubject({ withMask: true });

  const emitted = await page.evaluate(() => window.__cosmicCanvas.getMaskRle());
  const expected = encodeRLEMask(
    rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE),
    SHAPE
  );

  assert.equal(emitted, expected);
  // Documented asymmetry: the ingested string is 90 degrees clockwise of the
  // editor, so an untouched mask does NOT submit byte-identical to its input.
  assert.notEqual(emitted, fixture.mask_rle);

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('Reset mask restores the subject mask, not a threshold guess', async () => {
  const page = await openWithSubject({ withMask: true });

  assert.equal(await page.$eval('#brush-reset-mask', el => el.disabled), false);

  const seeded = await page.evaluate(() => window.__cosmicCanvas.brush.maskStats().checksum);
  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 80));
  await page.click('#brush-reset-mask');
  await new Promise(r => setTimeout(r, 80));

  const afterReset = await page.evaluate(() => window.__cosmicCanvas.brush.maskStats().checksum);
  assert.equal(afterReset, seeded);

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('a subject with no #mask_rle falls back to the threshold seed', async () => {
  const page = await openWithSubject({ withMask: false });

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.match(badge, /^Mask: threshold-fallback \((loaded|empty)\)$/);

  const actual = Uint8Array.from(await page.evaluate(readMask));
  const metadataMask = rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE);
  assert.notDeepEqual(actual, metadataMask, 'the fallback must not be the metadata mask');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('a malformed #mask_rle surfaces an error state instead of a blank canvas', async () => {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/subjects')) {
      const payload = subjectPayload({ withMask: true });
      payload.subjects[0].metadata['#mask_rle'] = '5 3 2 9';  // unsorted, overlapping
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(payload),
      });
    }
    req.continue();
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.equal(badge, 'Mask: metadata (error)');

  await page.close();
});
