/* HotelOps · Local persistence layer
 *
 * Provides a `window.storage` API compatible with the original `HotelOps.jsx`:
 *   await window.storage.get(key) -> { value: string } | undefined
 *   await window.storage.set(key, value)
 *   await window.storage.delete(key)
 *
 * Strategy:
 *  - Primary: IndexedDB (hotelops/kv) — handles megabytes, no JSON-string limits.
 *  - Fallback: localStorage if IndexedDB unavailable (private mode, etc.).
 */

const DB_NAME = "hotelops";
const STORE = "kv";
const VERSION = 1;

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const storage = {
  async get(key) {
    try {
      const v = await idbGet(key);
      if (v !== undefined) return { value: v };
    } catch {
      const v = localStorage.getItem(key);
      if (v !== null) return { value: v };
    }
    return undefined;
  },
  async set(key, value) {
    try {
      await idbSet(key, value);
    } catch {
      localStorage.setItem(key, value);
    }
  },
  async delete(key) {
    try {
      await idbDelete(key);
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  },
};

if (typeof window !== "undefined") {
  // expose for HotelOps.jsx
  window.storage = storage;
}

export default storage;
