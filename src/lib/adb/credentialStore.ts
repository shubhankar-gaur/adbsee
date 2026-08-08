import AdbWebCredentialStore from "@yume-chan/adb-credential-web";

// The store's underlying IndexedDB database name is always "Tango" regardless
// of the appName passed here (appName only labels the key on-device).
const CREDENTIAL_DB_NAME = "Tango";

export const credentialStore = new AdbWebCredentialStore("ADBSee");

/** Deletes the persisted ADB key, forcing the on-device auth prompt to reappear next connect. */
export function forgetSavedKey(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CREDENTIAL_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error as Error);
    request.onblocked = () => resolve();
  });
}
