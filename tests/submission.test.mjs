/**
 * What the researcher actually receives. The T0 annotation value is the RLE
 * encoding of the mask the volunteer left on screen, and nothing else.
 *
 * Classification POSTs are intercepted rather than allowed through, so these
 * tests never write to the live project.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';
import { decodeRLEMask, encodeRLEMask, rotateMaskCounterClockwise } from '../mask.js';

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

/**
 * Serve one fixture subject and capture the classification POST without
 * letting it reach Panoptes.
 */
async function openWithCapture({ withMask }) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const captured = [];
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
  page._capturedErrors = errors;
  page._classifications = captured;

  const metadata = { '!RA': '85.7334616', '#object_id': 'fixture' };
  if (withMask) metadata['#mask_rle'] = fixture.mask_rle;

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/subjects')) {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ subjects: [{
          id: String(fixture.id),
          metadata,
          locations: fixture.locations,
          links: { project: '32203' },
        }] }),
      });
    }
    if (req.method() === 'POST' && req.url().includes('/api/classifications')) {
      captured.push(JSON.parse(req.postData()).classifications);
      return req.respond({
        status: 201,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ classifications: [{ id: '1' }] }),
      });
    }
    req.continue();
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  return page;
}

async function submit(page) {
  await page.click('#submit-button');
  await page.waitForFunction(
    () => !document.querySelector('#submission-result').hidden,
    { timeout: 30000 }
  );
}

test('an unedited subject mask submits as the RLE the editor is showing', async () => {
  const page = await openWithCapture({ withMask: true });
  await submit(page);

  const [classification] = page._classifications;
  const expected = encodeRLEMask(
    rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE),
    SHAPE
  );

  assert.equal(classification.annotations.length, 1);
  assert.equal(classification.annotations[0].task, 'T0');
  assert.equal(classification.annotations[0].value, expected);

  await page.close();
});

test('an edited mask submits the edit, and the edit decodes cleanly', async () => {
  const page = await openWithCapture({ withMask: true });
  const box = await page.evaluate(() => {
    const r = document.getElementById('brush-canvas').getBoundingClientRect();
    return { x: r.x, y: r.y };
  });

  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + 60 + i * 6, box.y + 60 + i * 4);
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 100));

  await submit(page);

  const [classification] = page._classifications;
  const seedRle = encodeRLEMask(
    rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE),
    SHAPE
  );
  const submitted = classification.annotations[0].value;

  assert.notEqual(submitted, seedRle, 'the volunteer edit must reach the researcher');
  assert.match(submitted, /^\d+( \d+)*$/);

  // Whatever we sent must decode back to exactly what was on screen.
  const decoded = decodeRLEMask(submitted, SHAPE);
  const onScreen = Uint8Array.from(await page.evaluate(() => Array.from(window.__cosmicCanvas.brush.mask)));
  assert.deepEqual(decoded, onScreen);

  await page.close();
});

test('an emptied mask submits an empty string, not a placeholder', async () => {
  const page = await openWithCapture({ withMask: true });

  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 80));
  await submit(page);

  const [classification] = page._classifications;
  assert.equal(classification.annotations[0].value, '',
    'an empty mask is a real answer; it must not become "No annotation"');

  await page.close();
});

test('a threshold-fallback subject also submits RLE', async () => {
  const page = await openWithCapture({ withMask: false });
  await submit(page);

  const [classification] = page._classifications;
  assert.match(classification.annotations[0].value, /^(\d+( \d+)*)?$/,
    'the fallback path must use the same wire format');

  await page.close();
});

test('advancing to the next subject does not carry the previous annotation', async () => {
  const page = await openWithCapture({ withMask: true });

  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 80));
  await page.click('#skip-button');
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  await submit(page);

  const [classification] = page._classifications;
  const expected = encodeRLEMask(
    rotateMaskCounterClockwise(decodeRLEMask(fixture.mask_rle, SHAPE), SHAPE),
    SHAPE
  );
  assert.equal(classification.annotations[0].value, expected,
    'the new subject re-seeds; it must not inherit the cleared mask');

  await page.close();
});
