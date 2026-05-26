// storage.js — работа с IndexedDB (только аниме)

const DB_NAME = 'AnimeScorerDB';
const DB_STORE = 'animes';

let db = null;
let dbInitPromise = null;

async function ensureDB() {
    if (db) return db;
    if (!dbInitPromise) {
        dbInitPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 2);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => {
                db = e.target.result;
                resolve(db);
            };
            request.onupgradeneeded = e => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains(DB_STORE)) {
                    database.createObjectStore(DB_STORE, { keyPath: 'id' });
                }
            };
        });
    }
    return dbInitPromise;
}

async function initDB() {
    return ensureDB();
}

async function dbLoadAll() {
    await ensureDB();
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = e => reject(e.target.error);
    });
}

async function dbSaveAll(list) {
    await ensureDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.clear();
    list.forEach(item => store.put(item));
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
        tx.onabort = e => reject(e.target.error);
    });
}

window.initDB = initDB;
window.dbLoadAll = dbLoadAll;
window.dbSaveAll = dbSaveAll;