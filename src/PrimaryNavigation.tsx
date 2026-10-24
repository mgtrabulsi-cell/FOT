import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function PrimaryNavigation({ children }: { children: ReactNode }) {
  const navigationRef = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const viewport = window.visualViewport;
    const update = () => {
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      navigationRef.current?.style.setProperty('--navigation-bottom', `${inset}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('pageshow', update);
      navigationRef.current?.style.removeProperty('--navigation-bottom');
    };
  }, [mobile]);
  const navigation = <nav ref={navigationRef} className={`primary-nav${mobile ? ' primary-nav-mobile' : ''}`} aria-label="Main navigation">{children}</nav>;
  return mobile ? createPortal(navigation, document.body) : navigation;
}
