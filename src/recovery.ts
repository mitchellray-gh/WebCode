import { readSession } from "./session";
import type { Session } from "./session";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("technicalskills-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("session");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recovery storage is blocked by another tab."));
  });
}

export async function recoverySession(value?: Session): Promise<Session | null> {
  const data = value ? readSession(value) : undefined;
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("session", data ? "readwrite" : "readonly");
      const store = transaction.objectStore("session");
      const request = data ? store.put(data, "current") : store.get("current");
      transaction.oncomplete = () => {
        try {
          resolve(data || (request.result ? readSession(request.result) : null));
        } catch (error) { reject(error); }
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Recovery save aborted."));
    });
  } finally { db.close(); }
}
