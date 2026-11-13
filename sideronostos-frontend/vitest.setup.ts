import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom has no layout engine; Radix ScrollArea observes dimensions in real browsers.
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
