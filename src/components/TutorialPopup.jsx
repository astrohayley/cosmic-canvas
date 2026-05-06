import { useEffect } from 'react';

function TutorialPopup({
  cards,
  currentIndex,
  onNext,
  onPrevious,
  onClose,
  onSelectStep,
}) {
  const activeCard = cards[currentIndex] || null;
  const isFirstCard = currentIndex === 0;
  const isLastCard = currentIndex === cards.length - 1;

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  if (!activeCard) {
    return null;
  }

  return (
    <section
      className="tutorial-popup"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tutorial-popup-title"
      aria-describedby="tutorial-popup-description"
    >
      <header className="tutorial-popup-header">
        <strong className="tutorial-popup-kicker">Quick Tutorial</strong>
        <button
          type="button"
          className="tutorial-close-button"
          onClick={onClose}
          aria-label="Close tutorial"
        >
          ×
        </button>
      </header>

      <div className="tutorial-popup-media">
        {activeCard.imageUrl ? (
          <img
            src={activeCard.imageUrl}
            alt={activeCard.imageAlt || activeCard.title}
            className="tutorial-popup-image"
          />
        ) : (
          <div className="tutorial-image-fallback">No image for this tutorial step.</div>
        )}
      </div>

      <div className="tutorial-popup-content">
        <h3 id="tutorial-popup-title" className="tutorial-popup-title">
          {activeCard.title}
        </h3>

        {activeCard.description && (
          <p id="tutorial-popup-description" className="tutorial-popup-copy">
            {activeCard.description}
          </p>
        )}

        {activeCard.instructions && (
          <p className="tutorial-popup-copy tutorial-popup-instructions">
            {activeCard.instructions}
          </p>
        )}
      </div>

      <div className="tutorial-popup-footer">
        <span className="tutorial-popup-progress">
          Step {currentIndex + 1} of {cards.length}
        </span>

        <div className="tutorial-popup-controls">
          <button
            type="button"
            className="tutorial-control-button"
            onClick={onPrevious}
            disabled={isFirstCard}
          >
            Back
          </button>

          <button
            type="button"
            className="tutorial-control-button"
            onClick={onClose}
          >
            Close
          </button>

          <button
            type="button"
            className="tutorial-control-button tutorial-control-button-primary"
            onClick={onNext}
          >
            {isLastCard ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      <div className="tutorial-popup-steps" aria-label="Tutorial step navigation">
        {cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            className={`tutorial-step-dot ${index === currentIndex ? 'active' : ''}`}
            onClick={() => onSelectStep(index)}
            aria-label={`Open step ${index + 1}: ${card.title}`}
          />
        ))}
      </div>
    </section>
  );
}

export default TutorialPopup;
