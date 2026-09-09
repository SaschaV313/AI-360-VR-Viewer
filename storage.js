export const DB_NAME = "ai-360-vr-viewer";
export const DB_VERSION = 2;
const STORE_NAME = "panoramas";

// WebKit can reject IndexedDB Blob writes even when image decoding works.
// Store binary bytes and reconstruct Blobs at the storage boundary. Old Blob
// records remain readable, and originals keep their exact byte content.
export function restoreRecord(record) {
  if (!record) return record;
  return {
    ...record,
    blob: record.blob instanceof ArrayBuffer ? new Blob([record.blob], { type: record.type || "image/jpeg" }) : record.blob,
    thumbnail: record.thumbnail instanceof ArrayBuffer ? new Blob([record.thumbnail], { type: record.thumbnailType || "image/jpeg" }) : record.thumbnail,
  };
}

// Version 2 also repairs databases created without a store by placeholder-state.js.
// Never delete the database: version-1 galleries must keep their original images.
export function openDatabase(name = DB_NAME, factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error("Lokaler Bildspeicher ist nicht verfügbar."));
    let settled = false;
    const request = factory.open(name, DB_VERSION);
    const timer = setTimeout(() => fail(new Error("Bildspeicher antwortet nicht. Andere Viewer-Tabs schließen und erneut laden.")), 8000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt");
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("Bildspeicher ist blockiert. Andere Viewer-Tabs schließen und erneut laden."));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) return db.close();
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// A successful request is not a committed transaction (quota failures can follow).
export function databaseRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error || new Error("Speichern wurde abgebrochen."));
    transaction.onerror = () => { /* The abort event supplies the final failure. */ };
  });
}

export class PanoramaStore {
  constructor() {
    this.db = null;
    this.temporary = new Map();
    this.error = null;
  }

  async init(name = DB_NAME, factory) {
    try {
      this.db = await openDatabase(name, factory);
      // Check reads too, before reporting storage as ready.
      await databaseRequest(this.db, "readonly", store => store.count());
    } catch (error) {
      this.db?.close();
      this.db = null;
      this.error = error;
    }
    return this;
  }

  async all() {
    const saved = this.db ? await databaseRequest(this.db, "readonly", store => store.getAll()) : [];
    const merged = new Map(saved.map(item => [item.id, restoreRecord(item)]));
    for (const [id, item] of this.temporary) merged.set(id, item);
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id) {
    return this.temporary.get(id) || (this.db ? restoreRecord(await databaseRequest(this.db, "readonly", store => store.get(id))) : undefined);
  }

  async put(record) {
    if (this.db) {
      try {
        const stored = { ...record, blob: await record.blob.arrayBuffer() };
        if (record.thumbnail) {
          stored.thumbnail = await record.thumbnail.arrayBuffer();
          stored.thumbnailType = record.thumbnail.type;
        }
        await databaseRequest(this.db, "readwrite", store => store.put(stored));
        this.temporary.delete(record.id);
        return true;
      } catch (error) {
        this.error = error;
      }
    }
    // Viewing remains available when persistence is blocked or storage is full.
    this.temporary.set(record.id, record);
    return false;
  }

  async delete(id) {
    if (this.db) await databaseRequest(this.db, "readwrite", store => store.delete(id));
    this.temporary.delete(id);
  }

  async clear() {
    if (this.db) await databaseRequest(this.db, "readwrite", store => store.clear());
    this.temporary.clear();
  }

  close() { this.db?.close(); }
}
