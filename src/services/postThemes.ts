export const postThemes = [
  { value: 'news', label: 'News', color: 'tnf' },
  { value: 'fantasy', label: 'Fantasy', color: 'snf' },
  { value: 'betting', label: 'Betting', color: 'mnf' },
] as const;
export type PostTheme = typeof postThemes[number]['value'];
