const rememberKey = 'gamewire-remember-device';

export function getRememberDevice() {
  try {
    return window.localStorage.getItem(rememberKey) !== 'false';
  } catch {
    return true;
  }
}

export function setRememberDevice(remember: boolean) {
  try {
    window.localStorage.setItem(rememberKey, String(remember));
  } catch {
    // Storage unavailable; the session simply won't persist.
  }
}

// Sessions go to localStorage when the device is remembered, otherwise to sessionStorage (cleared when the app or tab closes).
export const authStorage = {
  getItem(key: string) {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    const [target, other] = getRememberDevice()
      ? [window.localStorage, window.sessionStorage]
      : [window.sessionStorage, window.localStorage];
    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key: string) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};
