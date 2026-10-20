const blockedControls = 'button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="tablist"], [role="slider"], [draggable="true"], [data-swipe-back-ignore]';

export function connectSwipeBack(root: HTMLElement, onBack: () => void): () => void {
  let start: { id: number; x: number; y: number; time: number } | null = null;
  let claimed = false;
  const reset = () => { start = null; claimed = false; };
  root.setAttribute('data-swipe-back-root', '');
  const onStart = (event: TouchEvent) => {
    reset();
    if (!window.matchMedia('(max-width: 760px)').matches || event.touches.length !== 1
      || !(event.target instanceof Element) || event.target.closest('[data-swipe-back-root]') !== root
      || event.target.closest(blockedControls) || window.getSelection()?.toString()) return;
    const modal = document.querySelector('dialog[open], [aria-modal="true"]');
    if (modal && !modal.contains(event.target)) return;
    for (let element: Element | null = event.target; element && root.contains(element); element = element.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth) return;
      if (element === root) break;
    }
    const touch = event.touches[0];
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() };
  };
  const onMove = (event: TouchEvent) => {
    if (!start) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch.identifier !== start.id) { reset(); return; }
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (dy > 24 || dx < -12 || Date.now() - start.time > 1000) { reset(); return; }
    if (dx > 12 && dx > dy * 2) {
      if (!event.cancelable) { reset(); return; }
      event.preventDefault();
      claimed = true;
    }
  };
  const onEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    const back = start && claimed && event.touches.length === 0 && touch?.identifier === start.id
      && touch.clientX - start.x >= Math.max(72, window.innerWidth * 0.18)
      && Math.abs(touch.clientY - start.y) <= 24 && Date.now() - start.time <= 1000;
    reset();
    if (back) {
      event.preventDefault();
      onBack();
    }
  };
  root.addEventListener('touchstart', onStart, { passive: true });
  root.addEventListener('touchmove', onMove, { passive: false });
  root.addEventListener('touchend', onEnd, { passive: false });
  root.addEventListener('touchcancel', reset);
  return () => {
    root.removeEventListener('touchstart', onStart);
    root.removeEventListener('touchmove', onMove);
    root.removeEventListener('touchend', onEnd);
    root.removeEventListener('touchcancel', reset);
    root.removeAttribute('data-swipe-back-root');
  };
}
