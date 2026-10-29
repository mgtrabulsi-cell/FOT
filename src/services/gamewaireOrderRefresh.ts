const eventName = 'gamewire-pick-order-saved';
const storageKey = 'gamewire-pick-order-updated';

export function notifyPickOrderSaved() {
  window.dispatchEvent(new Event(eventName));
  try {
    localStorage.setItem(storageKey, `${Date.now()}:${Math.random()}`);
  } catch (cause) {
    console.error('Could not notify other tabs of the saved pick order; automatic refresh remains active.', cause);
  }
}

export function subscribePickOrderRefresh(refresh: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey) refresh(); };
  window.addEventListener(eventName, refresh);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, refresh);
    window.removeEventListener('storage', onStorage);
  };
}
