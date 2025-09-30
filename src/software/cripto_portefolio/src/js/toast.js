// toast.js - lightweight toast notification utility

let toastContainer;
const recentKeys = new Map(); // key -> timestamp
const DEDUPE_WINDOW = 5000; // ms

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'fixed z-50 top-4 right-4 flex flex-col gap-3 max-w-xs';
    document.body.appendChild(toastContainer);
  }
}

function showToast(message, type = 'info', opts = {}) {
  ensureContainer();
  const key = type + '|' + message;
  const now = Date.now();
  if (recentKeys.has(key) && now - recentKeys.get(key) < DEDUPE_WINDOW) return; // dedupe
  recentKeys.set(key, now);
  const div = document.createElement('div');
  const colorBase = type === 'error' ? 'bg-red-600 text-white' : type === 'success' ? 'bg-green-600 text-white' : type === 'warn' ? 'bg-amber-500 text-white' : 'bg-gray-800 text-white';
  div.className = `${colorBase} text-sm px-4 py-3 rounded-lg shadow-lg ring-1 ring-black/10 dark:ring-white/10 animate-fade-in`; // rely on Tailwind utility
  div.textContent = message;
  toastContainer.appendChild(div);
  const ttl = opts.ttl || 5000;
  setTimeout(() => {
    div.classList.add('opacity-0', 'translate-y-1', 'transition');
    setTimeout(() => div.remove(), 300);
  }, ttl);
}

export { showToast };
