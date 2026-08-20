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
