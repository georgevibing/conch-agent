/** Pages Conch shows inside its own browser. Self-contained: no scripts, no requests. */

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Shown in place of an address the guard keeps the browser away from. */
export function blockedPage(message: string, url: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kept away by Conch</title>
<style>
  :root { color-scheme: light dark; --bg: #fbf9f7; --fg: #211d1a; --muted: #6f6660; --card: #ffffff; --edge: #e9e2dc; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1217; --fg: #edeff2; --muted: #9c9fa3; --card: #161a1f; --edge: #2a2e33; } }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 30rem; margin: 1.5rem; padding: 2rem 2.25rem; background: var(--card);
    border: 1px solid var(--edge); border-radius: 20px; box-shadow: 0 1px 0 #fff4 inset, 0 12px 40px #0000001a; }
  .pearl { width: 44px; height: 44px; border-radius: 50%; margin-bottom: 1rem;
    background: radial-gradient(circle at 32% 28%, #fff 0 12%, #f6e7ef 30%, #d9e6f5 58%, #e8dcc9 80%, #c9b8ad 100%);
    box-shadow: 0 6px 18px #b9a0c055; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 0 0 .75rem; color: var(--muted); }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; color: var(--fg); }
</style>
</head>
<body>
<main>
  <div class="pearl" aria-hidden="true"></div>
  <h1>Conch kept the browser away from this address</h1>
  <p>${escape(message)}</p>
  <p><code>${escape(url)}</code></p>
</main>
</body>
</html>`;
}
