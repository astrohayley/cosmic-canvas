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
 *   brushConfig — brush tool configuration { colors, opacity, defaultSize }
 */
function BrushTool({ subject, selectedImageIndex = 0, onImageSelect, onAnnotate, brushConfig }) {
  const canvasRef = useRef(null);
  const [brushSize, setBrushSize] = useState(brushConfig?.defaultSize || 12);
  const [brushColor, setBrushColor] = useState(brushConfig?.colors?.[0] || '#00ff00');
  const [toolMode, setToolMode] = useState('brush');

  const imageEntries = subject ? getImageEntries(subject) : [];
  const activeImageIndex = imageEntries.length > 0
    ? Math.max(0, Math.min(selectedImageIndex, imageEntries.length - 1))
    : 0;
  const imageUrl = imageEntries[activeImageIndex]?.url || null;
  const isEraser = toolMode === 'eraser';
  const displayColor = isEraser ? '#ffffff' : brushColor;
  const brushAlpha = isEraser ? 1 : (brushConfig?.opacity || 0.5);

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

  // Clear strokes when subject changes
  useEffect(() => {
    canvasRef.current?.clear();
    setToolMode('brush');
  }, [subject?.id]);

  useEffect(() => {
    applyCompositeMode(toolMode);
  }, [toolMode, applyCompositeMode]);

  const handleChange = useCallback(() => {
    applyCompositeMode(toolMode);
    if (canvasRef.current && onAnnotate) {
      onAnnotate(canvasRef.current.getSaveData());
    }
  }, [applyCompositeMode, onAnnotate, toolMode]);

  const handleUndo = () => {
    canvasRef.current?.undo();
    // trigger onAnnotate after undo
    setTimeout(() => {
      if (canvasRef.current && onAnnotate) {
        onAnnotate(canvasRef.current.getSaveData());
      }
    }, 50);
  };

  const handleClear = () => {
    canvasRef.current?.eraseAll();
    if (onAnnotate) onAnnotate(null);
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
        </div>
      </div>

      <div className="subject-meta">
        <span className="text-muted" style={{ fontSize: '12px' }}>
          Subject {subject.id} — draw on the image, then click Done
        </span>
      </div>
    </div>
  );
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
