/** First focusable element on every page; appears on keyboard focus. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="bg-surface text-foreground rounded-control shadow-overlay border-border-strong sr-only z-(--z-toast) border px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-4"
    >
      Skip to main content
    </a>
  );
}
