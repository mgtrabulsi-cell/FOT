export function getInterfaceScale(element: HTMLElement): number {
  let scale = 1;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const zoom = getComputedStyle(current).zoom;
    scale *= zoom === 'normal' ? 1 : zoom.endsWith('%') ? Number.parseFloat(zoom) / 100 : Number.parseFloat(zoom);
  }
  return scale;
}
