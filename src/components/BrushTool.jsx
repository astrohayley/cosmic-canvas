import { useRef, useState, useCallback, useEffect } from 'react';
import CanvasDraw from 'react-canvas-draw';

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
 */
function BrushTool({ subject, onAnnotate }) {
  const canvasRef = useRef(null);
  const [brushSize, setBrushSize] = useState(12);
  const [brushColor, setBrushColor] = useState('#00ff00');

  const imageUrl = subject ? getImageUrl(subject) : null;

  // Clear strokes when subject changes
  useEffect(() => {
    canvasRef.current?.clear();
  }, [subject?.id]);

  const handleChange = useCallback(() => {
    if (canvasRef.current && onAnnotate) {
      onAnnotate(canvasRef.current.getSaveData());
    }
  }, [onAnnotate]);

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
      <div className="brush-canvas-wrap" onWheelCapture={handleWheel}>
        <CanvasDraw
          ref={canvasRef}
          onChange={handleChange}
          imgSrc={imageUrl || ''}
          brushColor={brushColor}
          brushRadius={brushSize}
          canvasWidth={500}
          canvasHeight={500}
          lazyRadius={0}
          catenaryColor={brushColor}
          hideInterface={false}
          backgroundColor="#000"
        />
      </div>

      <div className="brush-controls">
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
          {['#00ff00', '#ff0000', '#00bfff', '#ffff00', '#ff00ff', '#ffffff'].map(c => (
            <button
              key={c}
              className={`brush-color-btn${brushColor === c ? ' active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => setBrushColor(c)}
              title={c}
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

function getImageUrl(subject) {
  if (!subject.locations) return null;
  for (const location of subject.locations) {
    for (const [mimeType, url] of Object.entries(location)) {
      if (mimeType.startsWith('image/')) return url;
    }
  }
  return null;
}

export default BrushTool;
