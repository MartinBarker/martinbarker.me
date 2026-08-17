"use client";
// IndexedDB-backed storage for RipTag projects.
//
// Two object stores share one database:
//   `blobs`    — every large binary (source audio, exported tracks, images,
//                rendered video), keyed by a flat string.
//   `projects` — one JSON record per project: settings, track splits, and the
//                blob keys that belong to it. Small enough to read all at once.
//
// All IndexedDB access in the riptag route goes through this module. Opening
// the same database at two different versions from two modules throws
// VersionError, so there must be exactly one `openDB` in the route.

const DB_NAME = "vinyl_digitizer_store";
// v1 had only `blobs`. v2 adds `projects`.
const DB_VERSION = 2;
const BLOB_STORE = "blobs";
const PROJECT_STORE = "projects";

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab holding an older version open blocks the upgrade; surface it
    // rather than hanging forever on a promise that never settles.
    req.onblocked = () => reject(new Error("RipTag storage is open in another tab — close it and reload."));
  });
  // A failed open must not be cached, or every later call inherits the failure.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const tx = async (store, mode, fn) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
};

// ---- Blobs ----------------------------------------------------------------

export const blobKey = (projectId, kind, idx = 0) => `p:${projectId}:${kind}:${idx}`;

export const putBlob = (key, blob) => tx(BLOB_STORE, "readwrite", (s) => s.put(blob, key));
export const getBlob = (key) => tx(BLOB_STORE, "readonly", (s) => s.get(key));
export const deleteBlob = (key) => tx(BLOB_STORE, "readwrite", (s) => s.delete(key));

// Removes every blob belonging to a project. IDBKeyRange.bound over the shared
// `p:<id>:` prefix beats reading all keys and filtering in JS.
export async function deleteBlobsByPrefix(prefix) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(BLOB_STORE, "readwrite");
    const store = t.objectStore(BLOB_STORE);
    // "￿" sorts after any character that can follow the prefix.
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`, false, false);
    store.delete(range);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Restores a stored blob as a File so it can go straight back into the same
// code paths that handle a freshly dropped file.
export async function getFile(key, name, type) {
  const blob = await getBlob(key);
  if (!blob) return null;
  return new File([blob], name, { type: type || blob.type || "application/octet-stream" });
}

// ---- Projects -------------------------------------------------------------

export async function listProjects() {
  const all = await tx(PROJECT_STORE, "readonly", (s) => s.getAll());
  return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export const getProject = (id) => tx(PROJECT_STORE, "readonly", (s) => s.get(id));
export const putProject = (record) => tx(PROJECT_STORE, "readwrite", (s) => s.put(record));

export async function deleteProject(id) {
  await deleteBlobsByPrefix(`p:${id}:`);
  await tx(PROJECT_STORE, "readwrite", (s) => s.delete(id));
}

export async function deleteAllProjects() {
  const all = await listProjects();
  for (const p of all) await deleteProject(p.id);
}

// Drops the two heaviest asset classes (source audio + rendered video) while
// keeping settings, splits and images, so the project can still be re-rendered.
export async function trimProjectAssets(id) {
  const rec = await getProject(id);
  if (!rec) return null;
  const keys = [
    ...(rec.audioFiles || []).map(a => a.key),
    ...(rec.video ? [rec.video.key] : []),
  ];
  for (const k of keys) { try { await deleteBlob(k); } catch {} }
  const next = {
    ...rec,
    audioFiles: (rec.audioFiles || []).map(a => ({ ...a, key: null, evicted: true })),
    video: null,
    bytes: { ...(rec.bytes || {}), audio: 0, video: 0 },
    updatedAt: Date.now(),
  };
  next.bytes.total = (next.bytes.tracks || 0) + (next.bytes.images || 0);
  await putProject(next);
  return next;
}

// ---- Quota ----------------------------------------------------------------

export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? usage / quota : 0 };
  } catch { return null; }
}

// Asks the browser to make this origin's storage persistent, so the rendered
// videos aren't evicted under disk pressure. Silently no-ops where unsupported.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

// ---- Legacy single-slot helpers (pre-projects rendered video) --------------

export const idbSave = (key, blob) => putBlob(key, blob).catch(() => {});
export const idbLoad = (key) => getBlob(key).catch(() => null);
export const idbDelete = (key) => deleteBlob(key).catch(() => {});
