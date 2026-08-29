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
      -webkit-user-select: none;
      user-select: none;
    }
    .drag-handle:active { cursor: grabbing; background: #edf5ff; }
    .task-card.reordering {
      opacity: .98 !important;
      border: 1px solid #9fc5ee !important;
      box-shadow: 0 12px 30px rgba(37,99,235,.14) !important;
      z-index: 4;
    }
    .task-list > .task-swipe { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease; }
  `;
  document.head.appendChild(style);

  // IMPORTANT: do not stop propagation on the whole card. React's delegated
  // click handlers need the native touch/pointer sequence to produce a normal
  // single tap. Reordering is isolated to the dedicated handle instead.
  let active = null;
  let startY = 0;
  let raf = 0;
  let latestY = 0;
  let pointerId = null;

  const isHandle = target => target instanceof Element && !!target.closest('.drag-handle');
  const pointY = event => event.clientY ?? event.touches?.[0]?.clientY ?? 0;

  const down = event => {
    if (!isHandle(event.target)) return;
    const handle = event.target.closest('.drag-handle');
    const card = handle?.closest('.task-card');
    if (!card) return;
    active = card;
    pointerId = event.pointerId ?? null;
    startY = pointY(event);
    latestY = startY;
    card.style.willChange = 'transform';
    card.classList.add('reordering');
  };

  const move = event => {
    if (!active) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    latestY = pointY(event) || latestY;
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
    card.classList.remove('reordering');
    active = null;
    pointerId = null;
  };

  document.addEventListener('pointerdown', down, { capture: true });
  document.addEventListener('pointermove', move, { capture: true, passive: true });
  document.addEventListener('pointerup', up, { capture: true });
  document.addEventListener('pointercancel', up, { capture: true });
  document.addEventListener('touchstart', down, { capture: true, passive: true });
  document.addEventListener('touchmove', move, { capture: true, passive: true });
  document.addEventListener('touchend', up, { capture: true });
  document.addEventListener('touchcancel', up, { capture: true });
})();
