export function feedImageUrl(original: string): string {
  if (!/\.(png|jpe?g|webp)$/i.test(original) || !original.includes('/storage/v1/object/public/livewire-photos/')) return original;
  const url = new URL(original);
  url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  url.searchParams.set('width', '640');
  url.searchParams.set('quality', '75');
  url.searchParams.set('resize', 'contain');
  return url.href;
}
