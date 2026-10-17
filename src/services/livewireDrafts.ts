export type LivewireDraft = {
  title: string;
  body: string;
  source: string;
  themes: Array<'news' | 'fantasy' | 'betting'>;
  editing: string | null;
  photos: Array<{ path?: string; file?: File }>;
};

const database = 'gamewire-livewire-drafts';
let queue: Promise<unknown> = Promise.resolve();
const stopped = new Set<string>();

function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connection: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection?.close();
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    };
    const timer = setTimeout(() => {
      finish({ error: new Error('Draft storage did not respond. You can keep editing and retry saving.') });
      transaction?.abort();
    }, 5000);
    let opening: IDBOpenDBRequest;
    try { opening = indexedDB.open(database, 1); }
    catch (error) { finish({ error }); return; }
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts');
    opening.onerror = () => finish({ error: opening.error });
    opening.onblocked = () => finish({ error: new Error('Draft storage is blocked by another open version of GameWire.') });
    opening.onsuccess = () => {
      const db = opening.result;
      if (settled) { db.close(); return; }
      connection = db;
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction('drafts', mode);
        transaction = tx;
        const request = operation(tx.objectStore('drafts'));
        tx.oncomplete = () => finish({ value: request.result });
        tx.onabort = () => finish({ error: tx.error ?? request.error ?? new Error('Draft storage failed.') });
      } catch (error) {
        finish({ error });
      }
    };
  });
}

function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => undefined);
  return next;
}

export function loadLivewireDraft(userId: string): Promise<LivewireDraft | undefined> {
  return ordered(async () => {
    const value: LivewireDraft | undefined = await transact('readonly', (store) => store.get(userId));
    if (value === undefined) return value;
    if (!value || typeof value.title !== 'string' || typeof value.body !== 'string' || typeof value.source !== 'string'
      || (value.editing !== null && typeof value.editing !== 'string')
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
  });
}

export function saveLivewireDraft(userId: string, draft: LivewireDraft): Promise<unknown> {
  return ordered(() => {
    if (stopped.has(userId)) throw new Error('Draft saving stopped after account deletion.');
    const empty = !draft.title && !draft.body && !draft.source && !draft.themes.length && !draft.photos.length && !draft.editing;
    if (empty) return transact('readwrite', (store) => store.delete(userId));
    return transact('readwrite', (store) => store.put(draft, userId));
  });
}

export function deleteLivewireDraft(userId: string): Promise<unknown> {
  stopped.add(userId);
  return ordered(() => transact('readwrite', (store) => store.delete(userId)));
}
