/**
 * Codec for Cosmic Canvas masks.
 *
 * The wire format is a whitespace-delimited sequence of one-based
 * `start length` pairs. Pixels are flattened and reshaped in row-major
 * (C) order, matching NumPy's default `reshape((height, width))` behavior.
 */

function normalizeShape(shape) {
  const height = Array.isArray(shape) ? shape[0] : shape?.height;
  const width = Array.isArray(shape) ? shape[1] : shape?.width;

  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError('Mask height must be a positive safe integer');
  }
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new TypeError('Mask width must be a positive safe integer');
  }

  const pixelCount = height * width;
  if (!Number.isSafeInteger(pixelCount)) {
    throw new RangeError('Mask dimensions are too large');
  }

  return { height, width, pixelCount };
}

function parseIntegerToken(token, label) {
  if (!/^\d+$/.test(token)) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }

  const value = Number(token);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is outside the safe integer range`);
  }
  return value;
}

/**
 * Decode an RLE string to a row-major binary pixel buffer.
 *
 * A non-string value produces an all-background mask to match the supplied
 * Python reference implementation. Malformed strings throw rather than
 * silently returning a partially decoded mask.
 *
 * @param {unknown} maskRle
 * @param {{ height: number, width: number } | [number, number]} shape
 * @returns {Uint8Array}
 */
export function decodeRLEMask(maskRle, shape) {
  const { pixelCount } = normalizeShape(shape);
  const pixels = new Uint8Array(pixelCount);

  if (typeof maskRle !== 'string') return pixels;

  const trimmed = maskRle.trim();
  if (!trimmed) return pixels;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length % 2 !== 0) {
    throw new TypeError('RLE mask must contain start/length pairs');
  }

  let previousEnd = 0;

  for (let index = 0; index < tokens.length; index += 2) {
    const oneBasedStart = parseIntegerToken(tokens[index], 'RLE start');
    const length = parseIntegerToken(tokens[index + 1], 'RLE length');

    if (oneBasedStart < 1) {
      throw new RangeError('RLE starts use one-based indexing and must be at least 1');
    }
    if (length < 1) {
      throw new RangeError('RLE lengths must be at least 1');
    }

    const start = oneBasedStart - 1;
    const end = start + length;

    if (!Number.isSafeInteger(end) || end > pixelCount) {
      throw new RangeError('RLE run exceeds the mask dimensions');
    }
    if (start < previousEnd) {
      throw new RangeError('RLE runs must be sorted and non-overlapping');
    }

    pixels.fill(1, start, end);
    previousEnd = end;
  }

  return pixels;
}

/**
 * Encode a row-major binary pixel buffer into one-based `start length` RLE.
 * Any non-zero pixel is treated as foreground. Adjacent foreground pixels are
 * emitted as one run, so the output is flat even if edits previously overlapped.
 *
 * @param {ArrayLike<number>} pixels
 * @param {{ height: number, width: number } | [number, number]} shape
 * @returns {string}
 */
export function encodeRLEMask(pixels, shape) {
  const { pixelCount } = normalizeShape(shape);

  if (!pixels || typeof pixels.length !== 'number') {
    throw new TypeError('Mask pixels must be an array-like value');
  }
  if (pixels.length !== pixelCount) {
    throw new RangeError(`Mask contains ${pixels.length} pixels; expected ${pixelCount}`);
  }

  const runs = [];
  let runStart = -1;

  for (let index = 0; index <= pixelCount; index += 1) {
    const isForeground = index < pixelCount && pixels[index] !== 0;

    if (isForeground && runStart < 0) {
      runStart = index;
    } else if (!isForeground && runStart >= 0) {
      runs.push(String(runStart + 1), String(index - runStart));
      runStart = -1;
    }
  }

  return runs.join(' ');
}
