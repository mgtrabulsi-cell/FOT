import { createDraftStorage } from './draftStorage.ts';
import { angleSection, readAngles } from './theAngle.ts';
import type { Angle, AngleSection } from './theAngle.ts';

export type AngleDraft = { form: Angle; photos: Array<{ path?: string; file?: File }> };
const storage = createDraftStorage('gamewire-angle-drafts');
const key = (userId: string, section: AngleSection) => `${userId}:${section}`;

export async function loadAngleDraft(userId: string, section: AngleSection): Promise<AngleDraft | undefined> {
  const value = await storage.load(key(userId, section));
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || !('form' in value) || !value.form || typeof value.form !== 'object'
    || !('photos' in value) || !Array.isArray(value.photos) || value.photos.length > 4) {
    throw new Error('The saved storyline draft is invalid. It was not overwritten.');
  }
  // Local new stories have revision zero, and unfinished pick lines may still be blank.
  const { picks, revision, ...fields } = value.form as Partial<Angle>;
  const form = readAngles([{ ...fields, revision: revision === 0 ? 1 : revision }])[0];
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || angleSection(form) !== section
    || (picks !== undefined && (!Array.isArray(picks) || !picks.every((pick) => pick && typeof pick.id === 'string'
      && typeof pick.text === 'string' && pick.text.length <= 500 && ['pending', 'hit', 'miss'].includes(pick.result))))) {
    throw new Error('The saved storyline draft is invalid. It was not overwritten.');
  }
  const photos = value.photos.map((photo, index) => {
    if (!photo || typeof photo !== 'object' || (typeof photo.path !== 'string' && !(photo.file instanceof Blob))) {
      throw new Error('The saved storyline photos are invalid. They were not overwritten.');
    }
    const file: unknown = photo.file;
    if (file === undefined) return { path: photo.path as string };
    if (!(file instanceof Blob)) throw new Error('The saved storyline photo is invalid.');
    if (file instanceof File) return { file };
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type] ?? 'bin';
    return { file: new File([file], `restored-photo-${index + 1}.${extension}`, { type: file.type }) };
  });
  return { form: { ...form, revision, ...(picks ? { picks } : {}) }, photos };
}

export function saveAngleDraft(userId: string, section: AngleSection, draft: AngleDraft | undefined): Promise<unknown> {
  return storage.save(key(userId, section), draft);
}

export function deleteAngleDrafts(userId: string): Promise<unknown> {
  return storage.deleteAccount([key(userId, 'angle'), key(userId, 'news')]);
}
