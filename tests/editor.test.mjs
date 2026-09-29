/**
 * The mask editor is a binary pixel buffer, not a stack of translucent strokes.
 * These tests assert the properties a volunteer actually sees: paint never
 * darkens, the eraser really removes, and undo / clear / reset / image-switch
 * all operate on one shared buffer.
 */
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

async function openEditor() {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  page._capturedErrors = errors;

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  // Wait for the subject's mask to be seeded; the editor refuses strokes before that.
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  return page;
}

const maskStats = () => window.__cosmicCanvas.brush.maskStats();
const canvasBox = () => {
  const r = document.getElementById('brush-canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

async function stroke(page, box, from, to) {
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      box.x + from[0] + (to[0] - from[0]) * (i / steps),
      box.y + from[1] + (to[1] - from[1]) * (i / steps)
    );
  }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 80));
}

test('the mask is a binary buffer sized to the mask raster', async () => {
  const page = await openEditor();

  const stats = await page.evaluate(maskStats);
  assert.equal(stats.length, stats.width * stats.height);
  assert.ok(stats.onlyBinaryValues, 'every mask pixel must be 0 or 1');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('painting the same stroke twice changes nothing the second time', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await page.click('#brush-clear');
  await stroke(page, box, [80, 120], [240, 180]);
  const first = await page.evaluate(maskStats);

  await stroke(page, box, [80, 120], [240, 180]);
  const second = await page.evaluate(maskStats);

  assert.ok(first.foreground > 0, 'the first stroke must paint something');
  assert.equal(second.foreground, first.foreground, 'a repeated stroke must not add pixels');
  assert.equal(second.checksum, first.checksum, 'a repeated stroke must not change any pixel');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('a second pass over painted pixels does not darken them', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);
  const samplePixel = () => window.__cosmicCanvas.brush.ctx
    .getImageData(200, 200, 1, 1).data;

  await page.click('#brush-clear');
  await stroke(page, box, [100, 200], [300, 200]);
  await page.mouse.move(box.x + box.w + 60, box.y + box.h + 60); // cursor off-canvas
  const afterOnePass = await page.evaluate(() => Array.from(
    window.__cosmicCanvas.brush.ctx.getImageData(200, 200, 1, 1).data
  ));

  // Two more strokes crossing the same pixel. Under the old translucent-stroke
  // model each pass blended again and the intersection grew darker.
  await stroke(page, box, [200, 100], [200, 300]);
  await stroke(page, box, [100, 100], [300, 300]);
  await page.mouse.move(box.x + box.w + 60, box.y + box.h + 60);
  const afterThreePasses = await page.evaluate(() => Array.from(
    window.__cosmicCanvas.brush.ctx.getImageData(200, 200, 1, 1).data
  ));

  assert.ok(afterOnePass[3] > 0, 'the sampled pixel must actually be painted');
  assert.deepEqual(
    afterThreePasses, afterOnePass,
    'three overlapping passes must render exactly like one'
  );

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('the eraser clears foreground pixels from the buffer', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await page.click('#brush-clear');
  await stroke(page, box, [100, 150], [300, 150]);
  const painted = await page.evaluate(maskStats);

  await page.click('#brush-mode-eraser');
  await stroke(page, box, [180, 150], [220, 150]);
  const erased = await page.evaluate(maskStats);

  assert.ok(painted.foreground > 0);
  assert.ok(erased.foreground < painted.foreground, 'erasing must remove foreground pixels');
  assert.ok(erased.foreground > 0, 'erasing a segment must not wipe the whole stroke');
  assert.ok(erased.onlyBinaryValues);

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('undo restores the buffer exactly as it was before the stroke', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await page.click('#brush-clear');
  await stroke(page, box, [100, 100], [200, 200]);
  const beforeSecond = await page.evaluate(maskStats);

  await stroke(page, box, [260, 100], [360, 200]);
  const afterSecond = await page.evaluate(maskStats);
  assert.notEqual(afterSecond.checksum, beforeSecond.checksum);

  await page.click('#brush-undo');
  await new Promise(r => setTimeout(r, 80));
  const afterUndo = await page.evaluate(maskStats);

  assert.equal(afterUndo.checksum, beforeSecond.checksum, 'undo must restore the prior buffer');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('clear empties the buffer and the annotation', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await stroke(page, box, [100, 100], [300, 260]);
  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 80));

  const stats = await page.evaluate(maskStats);
  assert.equal(stats.foreground, 0);
  assert.equal(await page.evaluate(() => window.__cosmicCanvas.getMaskRle()), '');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('reset mask restores the seed buffer exactly', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  const seeded = await page.evaluate(maskStats);
  const resetEnabled = await page.evaluate(() => !document.getElementById('brush-reset-mask').disabled);

  await stroke(page, box, [100, 100], [300, 300]);
  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 80));
  assert.equal((await page.evaluate(maskStats)).foreground, 0);

  if (resetEnabled) {
    await page.click('#brush-reset-mask');
    await new Promise(r => setTimeout(r, 80));
    const afterReset = await page.evaluate(maskStats);
    assert.equal(afterReset.checksum, seeded.checksum, 'reset must restore the seeded mask byte for byte');
  }

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('switching subject images keeps one shared mask', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await page.click('#brush-clear');
  await stroke(page, box, [120, 140], [280, 240]);
  const before = await page.evaluate(maskStats);

  const thumbnails = await page.$$('#image-thumbnails .thumbnail-btn');
  if (thumbnails.length > 1) {
    await thumbnails[1].click();
    await new Promise(r => setTimeout(r, 150));
    const after = await page.evaluate(maskStats);
    assert.equal(after.checksum, before.checksum, 'the mask must survive an image switch');
  }

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('the annotation is the RLE encoding of the current buffer', async () => {
  const page = await openEditor();
  const box = await page.evaluate(canvasBox);

  await page.click('#brush-clear');
  await stroke(page, box, [140, 160], [300, 220]);

  const agreement = await page.evaluate(() => {
    const { encodeRLEMask } = window.__cosmicCanvas.mask;
    const { mask, dimensions } = window.__cosmicCanvas.brush;
    return {
      emitted: window.__cosmicCanvas.getMaskRle(),
      expected: encodeRLEMask(mask, dimensions),
    };
  });

  assert.ok(agreement.emitted.length > 0);
  assert.equal(agreement.emitted, agreement.expected);
  assert.match(agreement.emitted, /^\d+( \d+)*$/, 'the annotation must be bare start/length pairs');

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});
