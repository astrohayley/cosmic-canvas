import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  decodeRLEMask,
  encodeRLEMask,
  getMetadataMaskRLE,
  rotateMaskCounterClockwise,
  paintMaskStroke
} from '../mask.js';

const subject = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/subject-117414478.json', import.meta.url)),
  'utf8'
));

// --- RLE codec ---------------------------------------------------------

test('decodes one-based start/length pairs in row-major order', () => {
  const pixels = decodeRLEMask('2 3 7 2', { height: 2, width: 4 });

  assert.deepEqual(Array.from(pixels), [0, 1, 1, 1, 0, 0, 1, 1]);
});

test('matches the non-string fallback in the Python protocol', () => {
  assert.deepEqual(
    Array.from(decodeRLEMask(null, [2, 3])),
    [0, 0, 0, 0, 0, 0]
  );
});

test('encodes adjacent foreground pixels into flattened runs', () => {
  const pixels = Uint8Array.from([0, 1, 1, 2, 0, 0, 1, 1]);

  assert.equal(encodeRLEMask(pixels, [2, 4]), '2 3 7 2');
});

test('round-trips a binary mask', () => {
  const source = Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1, 1]);
  const shape = { height: 3, width: 3 };

  assert.deepEqual(decodeRLEMask(encodeRLEMask(source, shape), shape), source);
});

test('reads and round-trips the new subject metadata mask format', () => {
  const metadata = { '#mask_rle': '2 3 7 2', '!RA': '85.7334616' };
  const inputRle = getMetadataMaskRLE(metadata);

  assert.equal(inputRle, '2 3 7 2');
  assert.equal(encodeRLEMask(decodeRLEMask(inputRle, [2, 4]), [2, 4]), '2 3 7 2');
});

test('treats missing or non-string metadata masks as absent', () => {
  assert.equal(getMetadataMaskRLE(null), null);
  assert.equal(getMetadataMaskRLE({}), null);
  assert.equal(getMetadataMaskRLE({ '#mask_rle': [1, 2] }), null);
});

test('rotates a decoded metadata mask 90 degrees counterclockwise', () => {
  const pixels = Uint8Array.from([
    1, 2, 3,
    4, 5, 6
  ]);

  assert.deepEqual(
    Array.from(rotateMaskCounterClockwise(pixels, { height: 2, width: 3 })),
    [3, 6, 2, 5, 1, 4]
  );
});

test('rejects malformed and out-of-bounds runs', () => {
  assert.throws(() => decodeRLEMask('1 2 4', [2, 2]), /start\/length pairs/);
  assert.throws(() => decodeRLEMask('0 1', [2, 2]), /one-based indexing/);
  assert.throws(() => decodeRLEMask('4 2', [2, 2]), /exceeds/);
  assert.throws(() => decodeRLEMask('2 2 3 1', [2, 2]), /non-overlapping/);
});

test('rejects a pixel buffer with the wrong dimensions', () => {
  assert.throws(() => encodeRLEMask([0, 1], [2, 2]), /expected 4/);
});

// --- Real production subject -------------------------------------------

test('an untouched production mask submits back byte-identical', () => {
  const shape = { height: 500, width: 500 };

  assert.equal(
    encodeRLEMask(decodeRLEMask(subject.mask_rle, shape), shape),
    subject.mask_rle
  );
});

test('a production mask survives the display rotation and back', () => {
  const shape = { height: 500, width: 500 };
  const decoded = decodeRLEMask(subject.mask_rle, shape);

  // Four counterclockwise quarter-turns return the mask to its ingested
  // orientation, so the researcher gets back the raster they supplied.
  let pixels = decoded;
  for (let turn = 0; turn < 4; turn += 1) pixels = rotateMaskCounterClockwise(pixels, shape);

  assert.equal(encodeRLEMask(pixels, shape), subject.mask_rle);
});

// --- Binary stamping ---------------------------------------------------

const shape = { width: 9, height: 5 };

test('brush strokes set binary foreground pixels without accumulating values', () => {
  const mask = new Uint8Array(shape.width * shape.height);
  const stroke = {
    from: { x: 1, y: 2 }, to: { x: 7, y: 2 },
    radiusX: 1.5, radiusY: 1.5, value: 1
  };
  paintMaskStroke(mask, shape, stroke);
  const afterFirstPass = Array.from(mask);
  paintMaskStroke(mask, shape, stroke);

  assert.ok(mask.some(pixel => pixel === 1));
  assert.ok(mask.every(pixel => pixel === 0 || pixel === 1));
  assert.deepEqual(Array.from(mask), afterFirstPass, 'a second pass must change nothing');
});

test('eraser strokes clear foreground pixels', () => {
  const mask = new Uint8Array(shape.width * shape.height).fill(1);
  paintMaskStroke(mask, shape, {
    from: { x: 2, y: 2 }, to: { x: 6, y: 2 },
    radiusX: 1, radiusY: 1, value: 0
  });

  assert.ok(mask.some(pixel => pixel === 0));
  assert.ok(mask.some(pixel => pixel === 1));
});

test('continuous strokes do not leave gaps between distant pointer samples', () => {
  const mask = new Uint8Array(shape.width * shape.height);
  paintMaskStroke(mask, shape, {
    from: { x: 1, y: 2.5 }, to: { x: 8, y: 2.5 },
    radiusX: 0.75, radiusY: 0.75, value: 1
  });

  for (let x = 1; x < 8; x += 1) assert.equal(mask[2 * shape.width + x], 1);
});

test('the minimum-size brush always changes at least one pixel', () => {
  const mask = new Uint8Array(shape.width * shape.height);
  paintMaskStroke(mask, shape, {
    from: { x: 4, y: 2 }, to: { x: 4, y: 2 },
    radiusX: 0.5, radiusY: 0.5, value: 1
  });

  assert.ok(mask.some(pixel => pixel === 1));
});

test('decoded RLE edits encode back to the final binary membership', () => {
  const mask = decodeRLEMask('1 3 10 2', shape);
  paintMaskStroke(mask, shape, {
    from: { x: 1, y: 0.5 }, to: { x: 1, y: 0.5 },
    radiusX: 0.75, radiusY: 0.75, value: 0
  });
  paintMaskStroke(mask, shape, {
    from: { x: 4, y: 2 }, to: { x: 4, y: 2 },
    radiusX: 0.75, radiusY: 0.75, value: 1
  });

  const roundTripped = decodeRLEMask(encodeRLEMask(mask, shape), shape);
  assert.deepEqual(roundTripped, mask);
  assert.ok(mask.every(pixel => pixel === 0 || pixel === 1));
});

test('editing a real production mask still produces a legal RLE string', () => {
  const maskShape = { height: 500, width: 500 };
  const mask = decodeRLEMask(subject.mask_rle, maskShape);
  paintMaskStroke(mask, maskShape, {
    from: { x: 100, y: 100 }, to: { x: 140, y: 160 },
    radiusX: 6, radiusY: 6, value: 1
  });

  const encoded = encodeRLEMask(mask, maskShape);

  assert.notEqual(encoded, subject.mask_rle);
  assert.deepEqual(decodeRLEMask(encoded, maskShape), mask);
});

// --- The browser loads the same module ---------------------------------

test('the shipped page loads mask.js and decodes with it in the browser', async () => {
  const { startServer } = await import('./server.mjs');
  const puppeteer = (await import('puppeteer')).default;

  const server = await startServer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cosmicCanvas?.mask, { timeout: 30000 });

    const roundTripped = await page.evaluate((rle) => {
      const { decodeRLEMask, encodeRLEMask } = window.__cosmicCanvas.mask;
      const shape = { height: 500, width: 500 };
      return encodeRLEMask(decodeRLEMask(rle, shape), shape);
    }, subject.mask_rle);

    assert.equal(roundTripped, subject.mask_rle);
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
