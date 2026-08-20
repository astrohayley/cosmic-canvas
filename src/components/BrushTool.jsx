import { useRef, useState, useCallback, useEffect } from 'react';
import { encodeRLEMask } from '../utils/rleMask.mjs';
import { paintMaskStroke } from '../utils/binaryMask.mjs';

const DISPLAY_SIZE = 500;
const MAX_UNDO_STATES = 30;

function normalizeMaskConfig(machineMask = {}) {
  return {
    enabled: machineMask.enabled ?? true,
    threshold: machineMask.threshold ?? 128,
    invert: machineMask.invert ?? false
  };
}

/**
 * Binary mask editor for Panoptes subject images.
 * Brush strokes set foreground pixels and eraser strokes clear them.
 */
function BrushTool({
  subject,
  selectedImageIndex = 0,
  onImageSelect,
  onAnnotate,
  onMaskInfo,
  brushConfig,
  subjectTalkUrl
}) {
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const imagesRef = useRef([]);
  const maskRef = useRef(null);
  const initialMaskRef = useRef(null);
  const dimensionsRef = useRef(null);
  const historyRef = useRef([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const cursorPointRef = useRef(null);
  const activeImageIndexRef = useRef(0);
  const brushColorRef = useRef(brushConfig?.colors?.[0] || '#00ff00');
  const maskOpacityRef = useRef(brushConfig?.opacity ?? 0.3);
  const brushSizeRef = useRef(brushConfig?.defaultSize || 12);
  const toolModeRef = useRef('brush');

  const [brushSize, setBrushSize] = useState(brushConfig?.defaultSize || 12);
  const [brushColor, setBrushColor] = useState(brushColorRef.current);
  const [toolMode, setToolMode] = useState('brush');
  const [maskInfo, setMaskInfo] = useState({ source: 'none', status: 'none' });
  const [hasInitialMask, setHasInitialMask] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canvasError, setCanvasError] = useState(null);

  const imageEntries = subject ? getImageEntries(subject) : [];
  const imageSignature = imageEntries.map(entry => entry.url).join('\n');
  const activeImageIndex = imageEntries.length > 0
    ? Math.max(0, Math.min(selectedImageIndex, imageEntries.length - 1))
    : 0;
  const seedImageIndex = imageEntries.length > 0 ? imageEntries.length - 1 : 0;
  const isEraser = toolMode === 'eraser';
  const machineMaskConfig = normalizeMaskConfig(brushConfig?.machineMask);

  brushColorRef.current = brushColor;
  maskOpacityRef.current = brushConfig?.opacity ?? 0.3;
  activeImageIndexRef.current = activeImageIndex;
  brushSizeRef.current = brushSize;
  toolModeRef.current = toolMode;

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const dimensions = dimensionsRef.current;
    if (!canvas || !mask || !dimensions) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const activeImage = imagesRef.current[activeImageIndexRef.current];
    if (activeImage) context.drawImage(activeImage, 0, 0, canvas.width, canvas.height);

    let overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvasRef.current = overlayCanvas;
    }
    if (overlayCanvas.width !== dimensions.width || overlayCanvas.height !== dimensions.height) {
      overlayCanvas.width = dimensions.width;
      overlayCanvas.height = dimensions.height;
    }

    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) return;

    const overlay = overlayContext.createImageData(dimensions.width, dimensions.height);
    const { red, green, blue } = parseHexColor(brushColorRef.current);
    const alpha = Math.round(255 * Math.max(0, Math.min(1, maskOpacityRef.current)));

    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] === 0) continue;
      const offset = index * 4;
      overlay.data[offset] = red;
      overlay.data[offset + 1] = green;
      overlay.data[offset + 2] = blue;
      overlay.data[offset + 3] = alpha;
    }

    overlayContext.putImageData(overlay, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);

    const cursorPoint = cursorPointRef.current;
    if (cursorPoint) {
      context.save();
      context.beginPath();
      context.arc(cursorPoint.x, cursorPoint.y, brushSizeRef.current / 2, 0, Math.PI * 2);
      context.lineWidth = 1.5;

      if (toolModeRef.current === 'eraser') {
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      } else {
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.25)`;
        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, 0.95)`;
        context.fill();
      }

      context.stroke();
      context.restore();
    }
  }, []);

  const emitAnnotation = useCallback(() => {
    const mask = maskRef.current;
    const dimensions = dimensionsRef.current;
    if (!mask || !dimensions) return;
    onAnnotate?.(encodeRLEMask(mask, dimensions));
  }, [onAnnotate]);

  const pushUndoState = useCallback(() => {
    if (!maskRef.current) return;
    historyRef.current.push(maskRef.current.slice());
    if (historyRef.current.length > MAX_UNDO_STATES) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeMask = async () => {
      setCanvasError(null);
      setToolMode('brush');
      setHasInitialMask(false);
      setCanUndo(false);
      historyRef.current = [];
      cursorPointRef.current = null;
      maskRef.current = null;
      initialMaskRef.current = null;
      dimensionsRef.current = null;
      imagesRef.current = [];

      if (imageEntries.length === 0) {
        const info = { source: 'none', status: 'empty' };
        setMaskInfo(info);
        onMaskInfo?.(info);
        onAnnotate?.('');
        return;
      }

      try {
        const images = await Promise.all(imageEntries.map(entry => loadImage(entry.url)));
        if (cancelled) return;

        const dimensions = { width: images[0].naturalWidth, height: images[0].naturalHeight };
        const mismatchedImageIndex = images.findIndex(image => (
          image.naturalWidth !== dimensions.width || image.naturalHeight !== dimensions.height
        ));
        if (mismatchedImageIndex >= 0) {
          throw new Error(`Image ${mismatchedImageIndex + 1} dimensions do not match image 1`);
        }

        imagesRef.current = images;
        dimensionsRef.current = dimensions;

        let mask = new Uint8Array(dimensions.width * dimensions.height);
        let info = { source: 'none', status: 'none' };

        if (machineMaskConfig.enabled) {
          mask = buildThresholdMask(images[seedImageIndex], dimensions, machineMaskConfig);
          const hasForeground = mask.some(pixel => pixel === 1);
          info = {
            source: 'threshold',
            status: hasForeground ? 'loaded' : 'empty',
            threshold: machineMaskConfig.threshold,
            invert: machineMaskConfig.invert,
            imageIndex: seedImageIndex
          };
        }

        maskRef.current = mask;
        initialMaskRef.current = mask.slice();
        setHasInitialMask(true);
        setMaskInfo(info);
        onMaskInfo?.(info);
        renderCanvas();
        emitAnnotation();
      } catch (error) {
        if (cancelled) return;
        const info = {
          source: machineMaskConfig.enabled ? 'threshold' : 'none',
          status: 'error',
          error: error.message
        };
        setCanvasError(error.message);
        setMaskInfo(info);
        onMaskInfo?.(info);
        onAnnotate?.('');
        console.warn('Failed to initialize binary mask:', error.message);
      }
    };

    initializeMask();
    return () => { cancelled = true; };
  }, [
    subject?.id,
    imageSignature,
    seedImageIndex,
    machineMaskConfig.enabled,
    machineMaskConfig.threshold,
    machineMaskConfig.invert,
    emitAnnotation,
    onAnnotate,
    onMaskInfo,
    renderCanvas
  ]);

  useEffect(() => {
    renderCanvas();
  }, [activeImageIndex, brushColor, brushSize, toolMode, brushConfig?.opacity, renderCanvas]);

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const paintBetween = (from, to) => {
    const mask = maskRef.current;
    const dimensions = dimensionsRef.current;
    if (!mask || !dimensions) return;

    paintMaskStroke(mask, dimensions, {
      from: {
        x: from.x * dimensions.width / DISPLAY_SIZE,
        y: from.y * dimensions.height / DISPLAY_SIZE
      },
      to: {
        x: to.x * dimensions.width / DISPLAY_SIZE,
        y: to.y * dimensions.height / DISPLAY_SIZE
      },
      radiusX: (brushSize / 2) * dimensions.width / DISPLAY_SIZE,
      radiusY: (brushSize / 2) * dimensions.height / DISPLAY_SIZE,
      value: isEraser ? 0 : 1
    });
    renderCanvas();
  };

  const handlePointerDown = (event) => {
    if (!maskRef.current || canvasError) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    canvasRef.current?.setPointerCapture(event.pointerId);
    cursorPointRef.current = point;
    pushUndoState();
    drawingRef.current = true;
    lastPointRef.current = point;
    paintBetween(point, point);
  };

  const handlePointerMove = (event) => {
    const point = getCanvasPoint(event);
    if (!point) return;
    cursorPointRef.current = point;

    if (!drawingRef.current) {
      renderCanvas();
      return;
    }
    if (!lastPointRef.current) return;
    event.preventDefault();
    paintBetween(lastPointRef.current, point);
    lastPointRef.current = point;
  };

  const finishStroke = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event && canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    emitAnnotation();
  };

  const handlePointerEnter = (event) => {
    cursorPointRef.current = getCanvasPoint(event);
    renderCanvas();
  };

  const handlePointerLeave = () => {
    cursorPointRef.current = null;
    renderCanvas();
  };

  const handleUndo = () => {
    const previousMask = historyRef.current.pop();
    if (!previousMask) return;
    maskRef.current = previousMask;
    setCanUndo(historyRef.current.length > 0);
    renderCanvas();
    emitAnnotation();
  };

  const handleClear = () => {
    if (!maskRef.current) return;
    pushUndoState();
    maskRef.current.fill(0);
    renderCanvas();
    emitAnnotation();
  };

  const handleResetToInitialMask = () => {
    if (!initialMaskRef.current) return;
    pushUndoState();
    maskRef.current = initialMaskRef.current.slice();
    setToolMode('brush');
    renderCanvas();
    emitAnnotation();
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 2 : -2;
    setBrushSize(previous => Math.max(1, Math.min(80, previous + delta)));
  };

  if (!subject) return <div className="subject-viewer-empty">No subject loaded</div>;

  return (
    <div className="brush-tool">
      {imageEntries.length > 1 && (
        <div className="image-thumbnails" role="tablist" aria-label="Subject images">
          {imageEntries.map((entry, index) => {
            const isActive = index === activeImageIndex;
            return (
              <button
                key={`${entry.locationIndex}-${entry.mimeType}`}
                type="button"
                className={`thumbnail-btn${isActive ? ' active' : ''}`}
                onClick={() => onImageSelect?.(index)}
                aria-label={`Show image ${index + 1}`}
                aria-selected={isActive}
                title={`Image ${index + 1}`}
              >
                <img src={entry.url} alt={`Thumbnail ${index + 1}`} className="thumbnail-image" />
                <span className="thumbnail-count">{index + 1}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="brush-canvas-wrap" onWheel={handleWheel}>
        <canvas
          ref={canvasRef}
          width={DISPLAY_SIZE}
          height={DISPLAY_SIZE}
          className="binary-mask-canvas"
          aria-label="Binary mask editor"
          onPointerEnter={handlePointerEnter}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={handlePointerLeave}
        />

        {canvasError && <div className="brush-canvas-error">{canvasError}</div>}

        {subjectTalkUrl && (
          <a href={subjectTalkUrl} target="_blank" rel="noopener noreferrer" className="subject-talk-link">
            View on Talk
          </a>
        )}
      </div>

      <div className="brush-controls">
        <div className="brush-mode-toggle" role="group" aria-label="Drawing tool mode">
          <button
            type="button"
            className={`brush-mode-btn ${!isEraser ? 'active' : ''}`}
            onClick={() => setToolMode('brush')}
            aria-pressed={!isEraser}
          >
            Brush
          </button>
          <button
            type="button"
            className={`brush-mode-btn ${isEraser ? 'active' : ''}`}
            onClick={() => setToolMode('eraser')}
            aria-pressed={isEraser}
          >
            Eraser
          </button>
        </div>

        <span className={`brush-mode-indicator ${isEraser ? 'eraser' : 'brush'}`}>
          Mode: {isEraser ? 'Eraser' : 'Brush'}
        </span>

        <label className="brush-control-label">
          <span style={{ fontSize: '12px' }}>Size: {brushSize}px</span>
          <input
            type="range"
            min="1"
            max="80"
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="brush-slider"
          />
        </label>

        <div className="brush-colors">
          {(brushConfig?.colors || ['#00ff00']).map(color => (
            <button
              key={color}
              type="button"
              className={`brush-color-btn${brushColor === color ? ' active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setBrushColor(color)}
              title={color}
              disabled={isEraser}
              aria-label={`Use mask color ${color}`}
            />
          ))}
        </div>

        <div className="brush-actions">
          <button onClick={handleUndo} className="brush-action-btn" title="Undo" disabled={!canUndo}>
            Undo
          </button>
          <button onClick={handleClear} className="brush-action-btn" title="Clear all" disabled={!maskRef.current}>
            Clear
          </button>
          <button
            onClick={handleResetToInitialMask}
            className="brush-action-btn"
            title="Reset to seeded machine mask"
            disabled={!hasInitialMask}
          >
            Reset mask
          </button>
        </div>
      </div>

      <div className="subject-meta">
        <span className="text-muted" style={{ fontSize: '12px' }}>
          Subject {subject.id} — edit the binary mask, then click Done
        </span>
        <span className={`mask-info-badge ${maskInfo.status}`}>
          Mask: {maskInfo.source} ({maskInfo.status})
        </span>
      </div>
    </div>
  );
}

function buildThresholdMask(image, dimensions, options) {
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create the threshold mask canvas');

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(dimensions.width * dimensions.height);

  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const luminance = Math.round(
      0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
    );
    const thresholdHit = options.invert
      ? luminance <= options.threshold
      : luminance >= options.threshold;
    mask[index] = data[offset + 3] > 8 && thresholdHit ? 1 : 0;
  }

  return mask;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Subject image could not be loaded'));
    image.src = src;
  });
}

function getImageEntries(subject) {
  if (!subject?.locations) return [];
  const entries = [];
  subject.locations.forEach((location, locationIndex) => {
    Object.entries(location).forEach(([mimeType, url]) => {
      if (mimeType.startsWith('image/')) entries.push({ mimeType, url, locationIndex });
    });
  });
  return entries;
}

function parseHexColor(hex) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#00ff00';
  return {
    red: parseInt(normalized.slice(1, 3), 16),
    green: parseInt(normalized.slice(3, 5), 16),
    blue: parseInt(normalized.slice(5, 7), 16)
  };
}

export default BrushTool;
