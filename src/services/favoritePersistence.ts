import type { FavoriteTarget } from './sportsData';

export type FavoriteSnapshot = { favorites: FavoriteTarget[]; updatedAt: string } | null;
type Backup = { favorites: FavoriteTarget[]; base: FavoriteSnapshot; pending: boolean };
type Options = {
  userId: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  read: () => Promise<FavoriteSnapshot>;
  write: (favorites: FavoriteTarget[], base: FavoriteSnapshot) => Promise<FavoriteSnapshot>;
  changed: (favorites: FavoriteTarget[], ready: boolean) => void;
  error: (message: string) => void;
};

export function readFavorites(value: unknown): FavoriteTarget[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item.key !== 'string'
    || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.feedPath !== 'string'
    || (item.type !== 'team' && item.type !== 'player'))) throw new Error('Saved favorites are malformed; they have not been overwritten.');
  return value;
}

// Apply only this device's changes, retaining favorites added by another tab/device.
export function mergeFavoriteChanges(server: FavoriteTarget[], base: FavoriteTarget[], draft: FavoriteTarget[]) {
  const removed = new Set(base.filter((item) => !draft.some((next) => next.key === item.key)).map((item) => item.key));
  const added = draft.filter((item) => !base.some((previous) => previous.key === item.key));
  const merged = server.filter((item) => !removed.has(item.key));
  for (const item of added) if (!merged.some((next) => next.key === item.key)) merged.push(item);
  const baseOrder = base.filter((item) => draft.some((next) => next.key === item.key)).map((item) => item.key);
  const draftOrder = draft.filter((item) => base.some((previous) => previous.key === item.key)).map((item) => item.key);
  if (JSON.stringify(baseOrder) !== JSON.stringify(draftOrder)) {
    const positions = merged.flatMap((item, index) => draftOrder.includes(item.key) ? [index] : []);
    const reordered = draftOrder.flatMap((key) => merged.filter((item) => item.key === key));
    positions.forEach((position, index) => { merged[position] = reordered[index]; });
  }
  return merged;
}

export class FavoritePersistence {
  private readonly key: string;
  private favorites: FavoriteTarget[] = [];
  private base: FavoriteSnapshot = null;
  private pending = false;
  private ready = false;
  private stopped = false;
  private saving = false;
  private loading = false;
  private deviceError = '';

  constructor(private readonly options: Options) {
    this.key = `gamewire:favorites:account:v1:${options.userId}`;
  }
  private backup() {
    try {
      this.options.storage.setItem(this.key, JSON.stringify({
        favorites: this.favorites, base: this.base, pending: this.pending,
      } satisfies Backup));
      this.deviceError = '';
    } catch (cause) {
      console.error('Account favorites backup could not save', cause);
      this.deviceError = 'Favorites could not be backed up on this device. Keep this page open until the cloud save succeeds.';
      this.options.error(this.deviceError);
    }
  }
  async load() {
    if (this.stopped || this.loading || this.saving) return;
    this.loading = true;
    this.ready = false;
    try {
      const raw = this.options.storage.getItem(this.key);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || !('favorites' in saved) || !('base' in saved)
          || !('pending' in saved) || typeof saved.pending !== 'boolean') throw new Error('Device favorites backup is malformed.');
        this.favorites = readFavorites(saved.favorites);
        if (saved.base !== null) {
          if (typeof saved.base !== 'object' || !('favorites' in saved.base) || !('updatedAt' in saved.base)
            || typeof saved.base.updatedAt !== 'string') throw new Error('Device favorites backup is malformed.');
          this.base = { favorites: readFavorites(saved.base.favorites), updatedAt: saved.base.updatedAt };
        } else this.base = null;
        this.pending = saved.pending;
        this.options.changed(this.favorites, false);
      }
    } catch (cause) {
      console.error('Could not read device favorites backup', cause);
      this.deviceError = 'The device favorites backup could not load. Only verified cloud favorites will be shown.';
      this.options.error(this.deviceError);
    }
    try {
      const server = await this.options.read();
      if (this.stopped) return;
      const serverFavorites = server?.favorites ?? [];
      this.favorites = this.pending
        ? mergeFavoriteChanges(serverFavorites, this.base?.favorites ?? [], this.favorites) : serverFavorites;
      this.base = server;
      this.ready = true;
      this.backup();
      this.options.changed(this.favorites, true);
      this.options.error(this.deviceError);
    } catch (cause) {
      if (!this.stopped) {
        console.error('Could not load account favorites', cause);
        this.options.changed(this.favorites, false);
        this.options.error('Saved favorites could not load. Your device backup is retained; reconnect and retry before changing favorites.');
      }
    } finally {
      this.loading = false;
    }
    if (this.ready && this.pending && !this.stopped) await this.flush();
  }
  change(transform: (favorites: FavoriteTarget[]) => FavoriteTarget[]) {
    if (!this.ready || this.stopped) {
      this.options.error('Favorites are still loading or could not be verified. Retry loading saved favorites before making changes.');
      return;
    }
    const next = transform(this.favorites);
    if (JSON.stringify(next) === JSON.stringify(this.favorites)) return;
    this.favorites = next;
    this.pending = true;
    this.backup();
    this.options.changed(this.favorites, true);
    void this.flush();
  }
  async retry() {
    if (this.ready) await this.flush();
    else await this.load();
  }
  private async flush() {
    if (this.saving || this.stopped || !this.pending || !this.ready) return;
    this.saving = true;
    try {
      let conflicts = 0;
      while (this.pending && !this.stopped) {
        const sent = this.favorites;
        const saved = await this.options.write(sent, this.base);
        if (this.stopped) return;
        if (!saved) {
          if (++conflicts > 3) throw new Error('Favorites changed elsewhere repeatedly. Retry to merge your changes safely.');
          const server = await this.options.read();
          if (this.stopped) return;
          this.favorites = mergeFavoriteChanges(server?.favorites ?? [], this.base?.favorites ?? [], this.favorites);
          this.base = server;
          this.backup();
          this.options.changed(this.favorites, true);
          continue;
        }
        this.base = saved;
        this.pending = JSON.stringify(this.favorites) !== JSON.stringify(sent);
        this.backup();
        this.options.error(this.deviceError);
      }
    } catch (cause) {
      if (!this.stopped) {
        console.error('Account favorites could not save', cause);
        this.options.error('Your favorite changes have not synced. They are retained on this device when storage is available. Reconnect and retry saving.');
      }
    } finally {
      this.saving = false;
    }
  }
  stop() { this.stopped = true; }
}
