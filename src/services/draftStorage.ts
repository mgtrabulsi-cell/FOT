export function createDraftStorage(database: string) {
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

  return {
    load: (key: string): Promise<unknown> => ordered(() => transact('readonly', (store) => store.get(key))),
    save: (key: string, value: unknown): Promise<unknown> => ordered(() => {
      if (stopped.has(key)) throw new Error('Draft saving stopped after account deletion.');
      if (value === undefined) return transact('readwrite', (store) => store.delete(key));
      return transact('readwrite', (store) => store.put(value, key));
    }),
    deleteAccount: (keys: string[]): Promise<unknown> => {
      keys.forEach((key) => stopped.add(key));
      return ordered(async () => {
        for (const key of keys) await transact('readwrite', (store) => store.delete(key));
      });
    },
  };
}
