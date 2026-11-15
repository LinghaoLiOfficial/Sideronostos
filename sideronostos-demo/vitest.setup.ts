import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// Node 26 no longer provides Web Storage without --localstorage-file. Give jsdom
// tests the small Storage surface the app uses so tests remain deterministic.
const localValues = new Map<string, string>();
const testStorage: Storage = {
  get length() { return localValues.size; },
  clear() { localValues.clear(); },
  getItem(key) { return localValues.get(String(key)) ?? null; },
  key(index) { return [...localValues.keys()][index] ?? null; },
  removeItem(key) { localValues.delete(String(key)); },
  setItem(key, value) { localValues.set(String(key), String(value)); },
};
Object.defineProperty(window, "localStorage", { configurable: true, value: testStorage });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: testStorage });

// jsdom has no layout engine; Radix ScrollArea observes dimensions in real browsers.
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
