const database = "lexidraw-local-narration-v1";
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Local narration storage unavailable"));
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("checkpoints", mode),
        request = run(tx.objectStore("checkpoints"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () =>
        reject(new Error("Local narration storage unavailable"));
    });
  } finally {
    db.close();
  }
}
export const browserNarrationStore = {
  async load(scope: string) {
    const value: unknown = await transact("readonly", (s) => s.get(scope));
    if (value === undefined) return null;
    if (typeof value !== "string" || value.length > 63_000_000)
      throw new Error("Invalid local checkpoint");
    return value;
  },
  async save(scope: string, data: string, expected: string | null) {
    const db = await open();
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction("checkpoints", "readwrite"),
          store = tx.objectStore("checkpoints"),
          request = store.get(scope);
        let committed = false;
        request.onsuccess = () => {
          if ((request.result ?? null) !== expected) return;
          store.put(data, scope);
          committed = true;
        };
        tx.oncomplete = () => resolve(committed);
        tx.onerror = tx.onabort = () =>
          reject(new Error("Local narration storage unavailable"));
      });
    } finally {
      db.close();
    }
  },
  async clear(scope: string) {
    await transact("readwrite", (s) => s.delete(scope));
  },
};
const active = new Map<string, Set<() => Promise<void>>>();
export function registerNarration(account: string, end: () => Promise<void>) {
  const set = active.get(account) ?? new Set();
  set.add(end);
  active.set(account, set);
  return () => {
    set.delete(end);
  };
}
export async function clearNarrationAccount(account: string) {
  await Promise.all(Array.from(active.get(account) ?? [], (end) => end()));
  active.delete(account);
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite"),
        request = tx.objectStore("checkpoints").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = String(cursor.key);
        try {
          const scope: unknown = JSON.parse(key);
          if (Array.isArray(scope) && scope[0] === account) cursor.delete();
        } catch {}
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(new Error("Local narration cleanup failed"));
    });
  } finally {
    db.close();
  }
}
