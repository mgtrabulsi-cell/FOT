import { useEffect, useRef } from 'react';
import { getInterfaceScale } from './uiScale';
import { getPrimetimeFullTitle } from './services/sportsData';
import type { PrimetimeType } from './services/sportsData';

export default function DraggableTabs<T extends string>({ options, ariaLabel, className, selected, onSelect }: {
  options: Array<{ key: T; label: string; secondary?: string; primetime?: PrimetimeType | null }>;
  ariaLabel: string;
  className: string;
  selected: T;
  onSelect: (key: T) => void;
}) {
  const dragState = useRef({ pointerId: null as number | null, startX: 0, startScrollLeft: 0, moved: false, suppressClick: false, pressedKey: undefined as T | undefined });
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false, suppressClick: false,
      pressedKey: (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab-key]')?.dataset.tabKey as T | undefined,
    };
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (drag.moved) {
      const strip = event.currentTarget;
      strip.scrollLeft = drag.startScrollLeft - distance / getInterfaceScale(strip);
      event.preventDefault();
    }
  };
  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.suppressClick = drag.moved;
    if (drag.moved) window.setTimeout(() => { dragState.current.suppressClick = false; }, 0);
    if (!cancelled && !drag.moved && drag.pressedKey) onSelect(drag.pressedKey);
    drag.pointerId = null;
    drag.pressedKey = undefined;
    event.currentTarget.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={stripRef} className={className} role="tablist" aria-label={ariaLabel}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove}
    onPointerUp={(event) => finishPointer(event)} onPointerCancel={(event) => finishPointer(event, true)}
    onLostPointerCapture={(event) => { dragState.current.pointerId = null; event.currentTarget.classList.remove('is-dragging'); }}
    onClickCapture={(event) => {
      if (!dragState.current.suppressClick) return;
      event.preventDefault(); event.stopPropagation(); dragState.current.suppressClick = false;
    }}
  >{options.map((option) => <button key={option.key} data-tab-key={option.key} role="tab" aria-selected={selected === option.key} className={selected === option.key ? 'active' : ''} onClick={() => onSelect(option.key)}><b>{option.label}</b>{option.secondary && <small>{option.secondary}{option.primetime && <span className={`wire-primetime-tag tag-${option.primetime.toLowerCase()}`} title={getPrimetimeFullTitle(option.primetime)}>{option.primetime}</span>}</small>}</button>)}</div>;
}
