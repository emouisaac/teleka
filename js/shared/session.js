const SESSION_HINT_PREFIX = "teleka:session-hint:";

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSessionHint(role) {
  const storage = getStorage();
  if (!storage || !role) {
    return false;
  }

  return storage.getItem(`${SESSION_HINT_PREFIX}${role}`) === "1";
}

export function syncSessionHint(role, signedIn) {
  const storage = getStorage();
  if (!storage || !role) {
    return;
  }

  const key = `${SESSION_HINT_PREFIX}${role}`;
  if (signedIn) {
    storage.setItem(key, "1");
    return;
  }

  storage.removeItem(key);
}
