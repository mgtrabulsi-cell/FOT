import { createDraftStorage } from './draftStorage.ts';

export type LivewireDraft = {
  title: string;
  body: string;
  source: string;
  themes: Array<'news' | 'fantasy' | 'betting'>;
  editing: string | null;
  postToX?: boolean;
  photos: Array<{ path?: string; file?: File }>;
};

const storage = createDraftStorage('gamewire-livewire-drafts');

export async function loadLivewireDraft(userId: string): Promise<LivewireDraft | undefined> {
  const value = await storage.load(userId) as LivewireDraft | undefined;
  if (value === undefined) return value;
  if (!value || typeof value.title !== 'string' || typeof value.body !== 'string' || typeof value.source !== 'string'
    || (value.editing !== null && typeof value.editing !== 'string')
    || (value.postToX !== undefined && typeof value.postToX !== 'boolean')
    || !Array.isArray(value.themes) || !value.themes.every((theme) => ['news', 'fantasy', 'betting'].includes(theme))
    || !Array.isArray(value.photos) || value.photos.length > 4
    || !value.photos.every((photo) => photo && (typeof photo.path === 'string' || photo.file instanceof Blob))) {
    throw new Error('The saved LIVEWIRE draft is invalid. It was not overwritten.');
  }
  return {
    ...value,
    photos: value.photos.map((photo, index) => {
      if (!photo.file || photo.file instanceof File) return photo;
      const blob: Blob = photo.file;
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] ?? 'bin';
      return { ...photo, file: new File([blob], `restored-photo-${index + 1}.${extension}`, { type: blob.type }) };
    }),
  };
}

export function saveLivewireDraft(userId: string, draft: LivewireDraft): Promise<unknown> {
  const empty = !draft.title && !draft.body && !draft.source && !draft.themes.length && !draft.photos.length && !draft.editing;
  return storage.save(userId, empty ? undefined : draft);
}

export function deleteLivewireDraft(userId: string): Promise<unknown> {
  return storage.deleteAccount([userId]);
}
