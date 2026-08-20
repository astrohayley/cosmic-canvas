import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeRLEMask, encodeRLEMask } from './rleMask.mjs';

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

test('round-trips the supplied production-format example', () => {
  const rle = '112698 1 113193 11 113691 15 114189 19 114688 21 115187 23 115686 25 116186 25 116685 27 117185 27 117684 29 118184 29 118684 29 119184 29 119684 29 120183 31 120684 29 121184 29 121684 29 122184 29 122684 29 123185 27 123685 27 124186 25 124686 25 125187 23 125688 21 126189 19 126691 15 127193 11 127698 1';
  const shape = { height: 500, width: 500 };

  assert.equal(encodeRLEMask(decodeRLEMask(rle, shape), shape), rle);
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
