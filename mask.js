/**
 * Codec and stamping for Cosmic Canvas masks.
 *
 * The wire format is a whitespace-delimited sequence of one-based
 * `start length` pairs. Pixels are flattened and reshaped in row-major
 * (C) order, matching NumPy's default `reshape((height, width))` behavior.
 *
 * Loaded as an ES module by both the browser (via index.html) and the Node
 * test runner, so the shipped code and the tested code are the same bytes.
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
 * Read the machine-mask seed from Panoptes subject metadata.
 * The leading `#` marks the field as hidden in the standard classifier UI.
 */
export function getMetadataMaskRLE(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = metadata['#mask_rle'];
  return typeof value === 'string' ? value : null;
}

/**
 * Rotate a row-major pixel buffer 90 degrees counterclockwise.
 * Metadata masks currently arrive 90 degrees clockwise relative to the
 * displayed subject image, so this normalizes them into editor coordinates.
 */
export function rotateMaskCounterClockwise(pixels, shape) {
  const { height, width, pixelCount } = normalizeShape(shape);
  if (!pixels || typeof pixels.length !== 'number') {
    throw new TypeError('Mask pixels must be an array-like value');
  }
  if (pixels.length !== pixelCount) {
    throw new RangeError(`Mask contains ${pixels.length} pixels; expected ${pixelCount}`);
  }

  const rotated = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rotatedY = width - 1 - x;
      const rotatedX = y;
      rotated[rotatedY * height + rotatedX] = pixels[y * width + x];
    }
  }
  return rotated;
}

/**
 * Encode a row-major binary pixel buffer into one-based `start length` RLE.
 * Any non-zero pixel is treated as foreground. Adjacent foreground pixels are
 * emitted as one run, so the output is flat even if edits previously overlapped.
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

/** Paint a continuous elliptical stroke into a row-major binary mask. */
export function paintMaskStroke(pixels, shape, stroke) {
  const { width, height } = shape;
  if (!(pixels instanceof Uint8Array) || pixels.length !== width * height) {
    throw new RangeError('Binary mask dimensions do not match its pixel buffer');
  }

  // A radius below sqrt(1/2) can miss every pixel center when the pointer is
  // exactly on integer coordinates. Keep the 1px brush reliably visible.
  const radiusX = Math.max(0.75, stroke.radiusX);
  const radiusY = Math.max(0.75, stroke.radiusY);
  const distance = Math.hypot(stroke.to.x - stroke.from.x, stroke.to.y - stroke.from.y);
  const spacing = Math.max(0.5, Math.min(radiusX, radiusY) / 2);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const value = stroke.value ? 1 : 0;

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const centerX = stroke.from.x + (stroke.to.x - stroke.from.x) * progress;
    const centerY = stroke.from.y + (stroke.to.y - stroke.from.y) * progress;
    paintEllipse(pixels, width, height, centerX, centerY, radiusX, radiusY, value);
  }

  return pixels;
}

function paintEllipse(pixels, width, height, centerX, centerY, radiusX, radiusY, value) {
  const minX = Math.max(0, Math.floor(centerX - radiusX));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radiusX));
  const minY = Math.max(0, Math.floor(centerY - radiusY));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radiusY));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const normalizedX = (x + 0.5 - centerX) / radiusX;
      const normalizedY = (y + 0.5 - centerY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
        pixels[y * width + x] = value;
      }
    }
  }
}
