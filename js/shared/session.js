const SESSION_PREFIX = "teleka:session:";

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getSessionSnapshot(role) {
  const storage = getStorage();
  if (!storage || !role) {
    return null;
  }

  try {
    const value = storage.getItem(`${SESSION_PREFIX}${role}`);
    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value);
    if (!parsed?.authenticated || parsed?.user?.role !== role) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function hasSessionSnapshot(role) {
  return Boolean(getSessionSnapshot(role));
}

export function syncSessionSnapshot(role, auth) {
  const storage = getStorage();
  if (!storage || !role) {
    return;
  }

  const key = `${SESSION_PREFIX}${role}`;
  if (auth?.authenticated && auth?.user?.role === role) {
    storage.setItem(
      key,
      JSON.stringify({
        authenticated: true,
        user: auth.user
      })
    );
    return;
  }

  storage.removeItem(key);
}

export function clearSessionSnapshot(role) {
  const storage = getStorage();
  if (!storage || !role) {
    return;
  }

  storage.removeItem(`${SESSION_PREFIX}${role}`);
}
