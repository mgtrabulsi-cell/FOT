import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

interface BannerSearchProps {
  kind: 'games' | 'players';
  query: string;
  onQueryChange: (query: string) => void;
}

export default function BannerSearch({ kind, query, onQueryChange }: BannerSearchProps) {
  const [text, setText] = useState('');
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const games = kind === 'games';
  const label = games ? 'Search NFL games' : 'Search NFL players or teams';
  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setText('');
  };

  useEffect(() => {
    const onOutsidePointer = (event: Event) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('touchstart', onOutsidePointer, { capture: true, passive: true });
    document.addEventListener('click', onOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.removeEventListener('touchstart', onOutsidePointer, true);
      document.removeEventListener('click', onOutsidePointer, true);
    };
  }, []);

  return <details
    ref={detailsRef}
    className={`banner-search${query ? ' has-query' : ''}`}
    onToggle={(event) => {
      if (event.currentTarget.open) event.currentTarget.querySelector('input')?.focus();
      else setText('');
    }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      close();
      detailsRef.current?.querySelector('summary')?.focus();
    }}
  >
    <summary aria-label={label} title={label}><Search size={18} /></summary>
    <div className="banner-search-panel">
      <label className="search-field">
        <input
          aria-label={games ? 'Search NFL games by team' : label}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onQueryChange(event.target.value);
          }}
          placeholder={games ? 'Search teams…' : 'Search players or teams…'}
        />
      </label>
      <button
        className="icon-button"
        aria-label={games ? 'Clear game search' : 'Clear player search'}
        disabled={!query && !text}
        onClick={() => {
          setText('');
          onQueryChange('');
          detailsRef.current?.querySelector('input')?.focus();
        }}
      ><X size={16} /></button>
    </div>
  </details>;
}
