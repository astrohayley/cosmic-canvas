import { useRef, useState, useCallback, useEffect } from 'react';
import CanvasDraw from 'react-canvas-draw';

/**
 * Convert hex color to rgba with specified opacity
 */
function hexToRgba(hex, alpha = 0.5) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizeMaskConfig(machineMask = {}) {
  return {
    enabled: machineMask.enabled ?? true,
    threshold: machineMask.threshold ?? 128,
    invert: machineMask.invert ?? false,
    rowStep: machineMask.rowStep ?? 2,
    colStep: machineMask.colStep ?? 2,
    minRunLength: machineMask.minRunLength ?? 2,
    maxLines: machineMask.maxLines ?? 8000,
    opacity: machineMask.opacity ?? 0.28,
    brushRadius: machineMask.brushRadius ?? 1,
    canvasWidth: machineMask.canvasWidth ?? 500,
    canvasHeight: machineMask.canvasHeight ?? 500
  };
}

/**
 * BrushTool — canvas drawing tool for annotating subject images.
 *
 * Renders `react-canvas-draw` over the subject image. The brush stroke data
 * is passed back via `onAnnotate` as a JSON string that gets included in the
 * classification annotation submitted to Panoptes.
 *
 * Props:
 *   subject     — Panoptes subject (needs .locations for image URL)
 *   onAnnotate  — called with (saveData: string) on every stroke change
 *   onMaskInfo  — called with metadata when an initial machine mask is seeded
 *   brushConfig — brush tool configuration { colors, opacity, defaultSize }
 */
function BrushTool({ subject, selectedImageIndex = 0, onImageSelect, onAnnotate, onMaskInfo, brushConfig }) {
  const canvasRef = useRef(null);
  const undoInProgressRef = useRef(false);
  const [brushSize, setBrushSize] = useState(brushConfig?.defaultSize || 12);
  const [brushColor, setBrushColor] = useState(brushConfig?.colors?.[0] || '#00ff00');
  const [toolMode, setToolMode] = useState('brush');
  const [initialMaskSaveData, setInitialMaskSaveData] = useState(null);
  const [maskInfo, setMaskInfo] = useState({ source: 'none', status: 'none' });

  const imageEntries = subject ? getImageEntries(subject) : [];
  const activeImageIndex = imageEntries.length > 0
    ? Math.max(0, Math.min(selectedImageIndex, imageEntries.length - 1))
    : 0;
  const imageUrl = imageEntries[activeImageIndex]?.url || null;
  const seedImageEntry = imageEntries.length > 0 ? imageEntries[imageEntries.length - 1] : null;
  const seedImageUrl = seedImageEntry?.url || null;
  const seedImageIndex = imageEntries.length > 0 ? imageEntries.length - 1 : 0;
  const isEraser = toolMode === 'eraser';
  const displayColor = isEraser ? '#ffffff' : brushColor;
  const brushAlpha = isEraser ? 1 : (brushConfig?.opacity || 0.5);
  const machineMaskConfig = normalizeMaskConfig(brushConfig?.machineMask);

  const applyCompositeMode = useCallback((mode) => {
    const instance = canvasRef.current;
    if (!instance?.ctx) return;

    const drawingMode = mode === 'eraser' ? 'destination-out' : 'source-over';
    const drawingCtx = instance.ctx.drawing;
    const tempCtx = instance.ctx.temp;

    // Keep temp in normal draw mode so it can act as an opaque erase mask.
    if (tempCtx && tempCtx.globalCompositeOperation !== 'source-over') {
      tempCtx.globalCompositeOperation = 'source-over';
    }
    if (drawingCtx && drawingCtx.globalCompositeOperation !== drawingMode) {
      drawingCtx.globalCompositeOperation = drawingMode;
    }
  }, []);

  // Clear and seed a single initial mask per subject, based on the last image.
  useEffect(() => {
    let cancelled = false;

    const loadInitialMask = async () => {
      const instance = canvasRef.current;
      if (!instance) return;

      instance.clear();
      setToolMode('brush');
      setInitialMaskSaveData(null);

      let saveData = null;
      let info = { source: 'none', status: 'none' };

      if (machineMaskConfig.enabled && seedImageUrl) {
        try {
          saveData = await buildThresholdMaskSaveData(seedImageUrl, {
            ...machineMaskConfig,
            color: brushColor,
            opacity: brushConfig?.opacity ?? machineMaskConfig.opacity
          });
          if (saveData) {
            info = {
              source: 'threshold',
              status: 'loaded',
              threshold: machineMaskConfig.threshold,
              invert: machineMaskConfig.invert,
              imageIndex: seedImageIndex
            };
          } else {
            info = {
              source: 'threshold',
              status: 'empty',
              threshold: machineMaskConfig.threshold,
              invert: machineMaskConfig.invert,
              imageIndex: seedImageIndex
            };
          }
        } catch (err) {
          info = {
            source: 'threshold',
            status: 'error',
            threshold: machineMaskConfig.threshold,
            invert: machineMaskConfig.invert,
            imageIndex: seedImageIndex,
            error: err.message
          };
          console.warn('Failed to generate threshold seed mask:', err.message);
        }
      }

      if (cancelled) return;

      if (saveData) {
        instance.loadSaveData(saveData, true);
        setInitialMaskSaveData(saveData);
        applyCompositeMode('brush');
        window.setTimeout(() => {
          if (!cancelled && canvasRef.current && onAnnotate) {
            onAnnotate(canvasRef.current.getSaveData());
          }
        }, 0);
      } else if (onAnnotate) {
        onAnnotate(null);
      }

      setMaskInfo(info);
      onMaskInfo?.(info);
    };

    loadInitialMask();

    return () => {
      cancelled = true;
    };
  }, [
    subject?.id,
    seedImageUrl,
    seedImageIndex,
    machineMaskConfig.enabled,
    machineMaskConfig.threshold,
    machineMaskConfig.invert,
    machineMaskConfig.rowStep,
    machineMaskConfig.colStep,
    machineMaskConfig.minRunLength,
    machineMaskConfig.maxLines,
    machineMaskConfig.opacity,
    machineMaskConfig.brushRadius,
    machineMaskConfig.canvasWidth,
    machineMaskConfig.canvasHeight,
    onAnnotate,
    onMaskInfo,
    applyCompositeMode
  ]);

  useEffect(() => {
    applyCompositeMode(toolMode);
  }, [toolMode, applyCompositeMode]);

  const handleChange = useCallback(() => {
    if (!undoInProgressRef.current) {
      applyCompositeMode(toolMode);
    }
    if (canvasRef.current && onAnnotate) {
      onAnnotate(canvasRef.current.getSaveData());
    }
  }, [applyCompositeMode, onAnnotate, toolMode]);

  const handleUndo = () => {
    // CanvasDraw replays historical lines during undo; replay must happen in
    // normal draw compositing or eraser mode can clear the whole drawing.
    undoInProgressRef.current = true;
    applyCompositeMode('brush');
    canvasRef.current?.undo();
    // trigger onAnnotate after undo
    setTimeout(() => {
      undoInProgressRef.current = false;
      applyCompositeMode(toolMode);
      if (canvasRef.current && onAnnotate) {
        onAnnotate(canvasRef.current.getSaveData());
      }
    }, 50);
  };

  const handleClear = () => {
    canvasRef.current?.eraseAll();
    if (onAnnotate) onAnnotate(null);
  };

  const handleResetToInitialMask = () => {
    if (!initialMaskSaveData || !canvasRef.current) return;
    canvasRef.current.clear();
    canvasRef.current.loadSaveData(initialMaskSaveData, true);
    setToolMode('brush');
    applyCompositeMode('brush');
    setTimeout(() => {
      if (canvasRef.current && onAnnotate) {
        onAnnotate(canvasRef.current.getSaveData());
      }
    }, 0);
  };

  const handleWheel = (e) => {
    const delta = e.deltaY > 0 ? 2 : -2;
    setBrushSize(prev => Math.max(1, Math.min(80, prev + delta)));
  };

  if (!subject) {
    return <div className="subject-viewer-empty">No subject loaded</div>;
  }

  return (
    <div className="brush-tool">
      {imageEntries.length > 1 && (
        <div className="image-thumbnails" role="tablist" aria-label="Subject images">
          {imageEntries.map((entry, idx) => {
            const isActive = idx === activeImageIndex;
            return (
              <button
                key={`${entry.locationIndex}-${entry.mimeType}`}
                type="button"
                className={`thumbnail-btn${isActive ? ' active' : ''}`}
                onClick={() => onImageSelect?.(idx)}
                aria-label={`Show image ${idx + 1}`}
                aria-selected={isActive}
                title={`Image ${idx + 1}`}
              >
                <img src={entry.url} alt={`Thumbnail ${idx + 1}`} className="thumbnail-image" />
                <span className="thumbnail-count">{idx + 1}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="brush-canvas-wrap" onWheelCapture={handleWheel}>
        <CanvasDraw
          ref={canvasRef}
          onChange={handleChange}
          imgSrc={imageUrl || ''}
          brushColor={hexToRgba(displayColor, brushAlpha)}
          brushRadius={brushSize}
          canvasWidth={500}
          canvasHeight={500}
          lazyRadius={0}
          catenaryColor={hexToRgba(displayColor, 0.9)}
          hideInterface={false}
          backgroundColor="#000"
        />
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
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="brush-slider"
          />
        </label>

        <div className="brush-colors">
          {(brushConfig?.colors || ['#00ff00', '#ff0000', '#00bfff', '#ffff00', '#ff00ff', '#ffffff']).map(c => (
            <button
              key={c}
              className={`brush-color-btn${brushColor === c ? ' active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => setBrushColor(c)}
              title={c}
              disabled={isEraser}
            />
          ))}
        </div>

        <div className="brush-actions">
          <button onClick={handleUndo} className="brush-action-btn" title="Undo">
            Undo
          </button>
          <button onClick={handleClear} className="brush-action-btn" title="Clear all">
            Clear
          </button>
          <button
            onClick={handleResetToInitialMask}
            className="brush-action-btn"
            title="Reset to seeded machine mask"
            disabled={!initialMaskSaveData}
          >
            Reset mask
          </button>
        </div>
      </div>

      <div className="subject-meta">
        <span className="text-muted" style={{ fontSize: '12px' }}>
          Subject {subject.id} — draw on the image, then click Done
        </span>
        <span className={`mask-info-badge ${maskInfo.status}`}>
          Mask: {maskInfo.source} ({maskInfo.status})
        </span>
      </div>
    </div>
  );
}

async function buildThresholdMaskSaveData(imageUrl, options) {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = options.canvasWidth;
  canvas.height = options.canvasHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const lines = [];
  const lineColor = hexToRgba(options.color, options.opacity);

  outer: for (let y = 0; y < canvas.height; y += options.rowStep) {
    let startX = -1;

    for (let x = 0; x <= canvas.width; x += options.colStep) {
      const inBounds = x < canvas.width;
      let isMaskPixel = false;

      if (inBounds) {
        const index = (y * canvas.width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];
        const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const thresholdHit = options.invert
          ? luminance <= options.threshold
          : luminance >= options.threshold;
        isMaskPixel = a > 8 && thresholdHit;
      }

      if (isMaskPixel) {
        if (startX < 0) startX = x;
      } else if (startX >= 0) {
        const endX = Math.min(canvas.width - 1, x - options.colStep);
        if (endX - startX + 1 >= options.minRunLength) {
          lines.push({
            points: [{ x: startX, y }, { x: endX, y }],
            brushColor: lineColor,
            brushRadius: options.brushRadius
          });
          if (lines.length >= options.maxLines) {
            break outer;
          }
        }
        startX = -1;
      }
    }
  }

  if (lines.length === 0) return null;

  return JSON.stringify({
    lines,
    width: canvas.width,
    height: canvas.height
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded for threshold mask generation'));
    image.src = src;
  });
}

function getImageEntries(subject) {
  if (!subject?.locations) return [];

  const entries = [];
  subject.locations.forEach((location, locationIndex) => {
    Object.entries(location).forEach(([mimeType, url]) => {
      if (mimeType.startsWith('image/')) {
        entries.push({ mimeType, url, locationIndex });
      }
    });
  });

  return entries;
}

export default BrushTool;
