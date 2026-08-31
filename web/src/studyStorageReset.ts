export const STUDYTUBE_STORAGE_EPOCH = "google-only-v1";

const STORAGE_EPOCH_KEY = "studytube.storageEpoch";

export function ensureStudyTubeStorageEpoch(
  localStorage: Storage,
  sessionStorage: Storage,
) {
  if (localStorage.getItem(STORAGE_EPOCH_KEY) === STUDYTUBE_STORAGE_EPOCH) {
    return;
  }
  clearStudyTubeStorage(localStorage);
  clearStudyTubeStorage(sessionStorage);
  localStorage.setItem(STORAGE_EPOCH_KEY, STUDYTUBE_STORAGE_EPOCH);
}

export function clearStudyTubeStorage(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith("studytube.") || key?.startsWith("studytube:")) {
      keys.push(key);
    }
  }
  for (const key of keys) storage.removeItem(key);
}
