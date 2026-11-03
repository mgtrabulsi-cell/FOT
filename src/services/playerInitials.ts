// First-initial + last-initial avatars (suffixes like Jr./III are not initials).
const suffixes = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (!parts.length) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : parts[0][1] ?? '';
  return `${first}${last}`.toUpperCase();
}
