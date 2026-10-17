import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function PrimaryNavigation({ children }: { children: ReactNode }) {
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
  const navigation = <nav className="primary-nav" aria-label="Main navigation">{children}</nav>;
  return mobile ? createPortal(navigation, document.body) : navigation;
}
