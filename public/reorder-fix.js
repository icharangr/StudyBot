(() => {
  const style = document.createElement('style');
  style.textContent = `
    button, a, input, select, textarea, [role="button"] { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .drag-handle { touch-action: none !important; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; cursor:grab; }
    .drag-handle:active { cursor:grabbing; }
    .task-card.reordering { opacity:.98 !important; border:1px solid #9fc5ee !important; box-shadow:0 12px 30px rgba(37,99,235,.14) !important; z-index:4; }
    .task-list > .task-swipe { transition:transform .18s cubic-bezier(.2,.8,.2,1),opacity .18s ease; }
  `;
  document.head.appendChild(style);

  // Use Pointer Events only. Mixing pointer and touch listeners on iOS can
  // create duplicate gesture processing and make ordinary taps feel slow.
  let active=null, startY=0, latestY=0, raf=0, pointerId=null;
  const isHandle=target=>target instanceof Element && !!target.closest('.drag-handle');

  const down=event=>{
    if(event.pointerType==='mouse' && event.button!==0) return;
    if(!isHandle(event.target)) return;
    const handle=event.target.closest('.drag-handle');
    const card=handle?.closest('.task-card');
    if(!card) return;
    active=card; pointerId=event.pointerId; startY=event.clientY; latestY=startY;
    card.style.willChange='transform'; card.classList.add('reordering');
    try{handle.setPointerCapture(event.pointerId);}catch{}
  };
  const move=event=>{
    if(!active || event.pointerId!==pointerId) return;
    latestY=event.clientY;
    if(Math.abs(latestY-startY)<2) return;
    if(!raf) raf=requestAnimationFrame(()=>{
      raf=0; if(!active) return;
      const delta=Math.max(-120,Math.min(120,latestY-startY));
      active.style.setProperty('transform',`translate3d(0,${delta}px) scale(1.012)`,'important');
    });
  };
  const up=event=>{
    if(!active || (event.pointerId!==undefined && event.pointerId!==pointerId)) return;
    const card=active; if(raf){cancelAnimationFrame(raf);raf=0;}
    card.style.setProperty('transform','translate3d(0,0,0) scale(1)','important');
    card.style.removeProperty('will-change'); card.classList.remove('reordering');
    active=null; pointerId=null;
  };
  document.addEventListener('pointerdown',down,{capture:true,passive:true});
  document.addEventListener('pointermove',move,{capture:true,passive:true});
  document.addEventListener('pointerup',up,{capture:true,passive:true});
  document.addEventListener('pointercancel',up,{capture:true,passive:true});
})();
