export function observePostViews(
  root: HTMLElement,
  record: (postId: string) => Promise<void>,
  report: (error: unknown) => void,
  options: { minimumRatio?: number; bottomInset?: number; allowOffline?: boolean } = {},
) {
  const minimumRatio = options.minimumRatio ?? 0;
  const visible = new Set<Element>();
  const counted = new Set<Element>();
  const observed = new Set<Element>();
  let stopped = false;
  const count = (element: Element) => {
    if (stopped || document.visibilityState !== 'visible' || (!navigator.onLine && !options.allowOffline) || counted.has(element)) return;
    const id = element.getAttribute('data-post-id');
    if (!id) return;
    counted.add(element);
    void record(id).catch((error: unknown) => {
      if (!stopped) report(error);
    });
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > 0 && entry.intersectionRatio >= minimumRatio) {
        visible.add(entry.target);
        count(entry.target);
      } else {
        visible.delete(entry.target);
        counted.delete(entry.target);
      }
    }
  }, { threshold: minimumRatio ? [0, minimumRatio] : [0, 0.01], rootMargin: `0px 0px -${options.bottomInset ?? 0}px 0px` });
  const sync = () => {
    const current = new Set(root.querySelectorAll('[data-post-id]'));
    for (const element of observed) {
      if (!current.has(element)) {
        observer.unobserve(element);
        observed.delete(element);
        visible.delete(element);
        counted.delete(element);
      }
    }
    for (const element of current) {
      if (!observed.has(element)) {
        observed.add(element);
        observer.observe(element);
      }
    }
  };
  const mutations = new MutationObserver(sync);
  mutations.observe(root, { childList: true, subtree: true });
  sync();
  const resume = () => {
    if (document.visibilityState !== 'visible') {
      counted.clear();
      return;
    }
    visible.forEach(count);
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  return () => {
    stopped = true;
    observer.disconnect();
    mutations.disconnect();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  };
}
