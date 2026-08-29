(() => {
  const style = document.createElement('style');
  style.textContent = `
    .task-card { position: relative; padding-left: 38px !important; }
    .drag-handle {
      position: absolute !important;
      left: 8px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      z-index: 5;
      width: 24px;
      height: 40px;
      margin: 0 !important;
      padding: 0 !important;
      display: grid !important;
      place-items: center !important;
      border-radius: 7px;
      font-size: 1rem !important;
      letter-spacing: -2px;
      color: #7890aa;
      cursor: grab;
      touch-action: none !important;
    }
    .drag-handle:active { cursor: grabbing; background: #edf5ff; }
    .task-card.reordering {
      opacity: .98 !important;
      border: 1px solid #9fc5ee !important;
      transform: scale(1.012) !important;
      box-shadow: 0 12px 30px rgba(37,99,235,.14) !important;
      transition: transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease !important;
      z-index: 4;
    }
    .task-list > .task-swipe { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease; }
  `;
  document.head.appendChild(style);

  const handleTarget = target => target instanceof Element && !!target.closest('.drag-handle');
  const cardTarget = target => target instanceof Element && !!target.closest('.task-card');

  // The existing Mission component has native listeners on the whole card.
  // Stop those listeners for normal card interaction; only the handle may start reorder.
  const guard = event => {
    if (cardTarget(event.target) && !handleTarget(event.target)) event.stopPropagation();
  };
  document.addEventListener('pointerdown', guard, true);
  document.addEventListener('touchstart', guard, true);

  // Smoothly lift and follow the card under the finger while the existing
  // persistence logic swaps its position after each movement threshold.
  let active = null;
  let startY = 0;
  let raf = 0;
  let latestY = 0;

  const down = event => {
    if (!handleTarget(event.target)) return;
    const handle = event.target.closest('.drag-handle');
    const card = handle?.closest('.task-card');
    if (!card) return;
    active = card;
    startY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    latestY = startY;
    card.style.willChange = 'transform';
  };
  const move = event => {
    if (!active) return;
    latestY = event.clientY ?? event.touches?.[0]?.clientY ?? latestY;
    if (Math.abs(latestY - startY) < 3) return;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (!active) return;
      const delta = Math.max(-90, Math.min(90, latestY - startY));
      active.style.setProperty('transform', `translate3d(0, ${delta}px) scale(1.012)`, 'important');
    });
  };
  const up = () => {
    if (!active) return;
    const card = active;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    card.style.setProperty('transform', 'translate3d(0,0,0) scale(1)', 'important');
    card.style.removeProperty('will-change');
    active = null;
  };

  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, {capture:true, passive:false});
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('touchstart', down, {capture:true, passive:true});
  document.addEventListener('touchmove', move, {capture:true, passive:false});
  document.addEventListener('touchend', up, true);
  document.addEventListener('touchcancel', up, true);
})();
