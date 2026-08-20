import test from 'node:test';
import assert from 'node:assert/strict';
import { paintMaskStroke } from './binaryMask.mjs';
import { decodeRLEMask, encodeRLEMask } from './rleMask.mjs';

const shape = { width: 9, height: 5 };

test('brush strokes set binary foreground pixels without accumulating values', () => {
  const mask = new Uint8Array(shape.width * shape.height);
  const stroke = {
    from: { x: 1, y: 2 }, to: { x: 7, y: 2 },
    radiusX: 1.5, radiusY: 1.5, value: 1
  };
  paintMaskStroke(mask, shape, stroke);
  paintMaskStroke(mask, shape, stroke);
  assert.ok(mask.some(pixel => pixel === 1));
  assert.ok(mask.every(pixel => pixel === 0 || pixel === 1));
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
