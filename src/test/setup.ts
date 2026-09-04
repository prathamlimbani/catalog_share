import "@testing-library/jest-dom";

// Node-environment suites (the storage service tests) have no window; the
// matchMedia shim is only for the jsdom ones.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Radix measures its trigger with ResizeObserver, which jsdom does not
  // implement — without it any suite that renders a Checkbox, Select or Popover
  // dies in a layout effect with "ResizeObserver is not defined", which reads
  // like a bug in the component under test rather than a missing shim.
  if (typeof window.ResizeObserver === "undefined") {
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
    globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  }
}
