/**
 * Keeps a CSS variable in step with the *visible* viewport height.
 *
 * The app shell was sized with `h-screen` (100vh). In a Capacitor WebView 100vh
 * is the full window and deliberately ignores the soft keyboard, so opening the
 * keyboard in a search field left the shell taller than the visible area — and
 * dismissing it left a dead band where the keyboard had been, as if the app
 * still occupied that space.
 *
 * `window.visualViewport` reports what the user can actually see, keyboard
 * included, so the shell tracks it exactly. Browsers without visualViewport
 * fall back to the `100dvh` default baked into the CSS.
 */
export function installViewportHeight(): () => void {
  const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
  if (!vv) return () => {};

  let last = -1;

  // Written synchronously rather than inside requestAnimationFrame: rAF does not
  // run while the page is hidden, so a coalescing guard would latch shut if the
  // keyboard opened or closed while the app was backgrounded, and the shell
  // would stay the wrong height after resuming. A single style write is cheap,
  // and skipping unchanged values keeps the repeated scroll events free.
  const apply = () => {
    // Round up: a fractional height can leave a hairline gap at the bottom.
    const h = Math.ceil(vv.height);
    if (h === last) return;
    last = h;
    document.documentElement.style.setProperty("--app-h", `${h}px`);
  };

  apply();
  vv.addEventListener("resize", apply);
  // The keyboard can also shift the viewport without resizing it.
  vv.addEventListener("scroll", apply);
  window.addEventListener("orientationchange", apply);

  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    window.removeEventListener("orientationchange", apply);
    document.documentElement.style.removeProperty("--app-h");
  };
}
