import { reduced } from './scroll';

/**
 * Colour pairs the site rotates through. Each is one loud light + one deep
 * dark (≥ 5:1). The values live in global.css; this list just names them.
 */
export const PALETTES = ['citrus', 'lime', 'bubblegum', 'tangerine'] as const;
type Palette = (typeof PALETTES)[number];

const KEY = 'cichlid:palette';
const SINCE = 'cichlid:palette-since';
const EVERY_MS = 25_000;
const root = document.documentElement;

function read(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* rotation still works, it just restarts on reload */
  }
}

const current = (): Palette => {
  const p = read(KEY) as Palette | null;
  return p && PALETTES.includes(p) ? p : 'citrus';
};

const svg = (body: string, size: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${body}</svg>`)}")`;

/** Cursor images, favicon and theme-color can't read CSS variables; rebuild them. */
function syncAssets() {
  const cs = getComputedStyle(root);
  const light = cs.getPropertyValue('--light').trim();
  const dark = cs.getPropertyValue('--dark').trim();
  root.style.setProperty(
    '--cursor-dot',
    `${svg(`<circle cx='12' cy='12' r='6.5' fill='${dark}' stroke='${light}' stroke-width='3'/>`, 24)} 12 12, auto`,
  );
  root.style.setProperty(
    '--cursor-ring',
    `${svg(
      `<circle cx='18' cy='18' r='14' fill='none' stroke='${light}' stroke-width='6'/><circle cx='18' cy='18' r='14' fill='none' stroke='${dark}' stroke-width='2.5'/><circle cx='18' cy='18' r='4' fill='${dark}' stroke='${light}' stroke-width='2'/>`,
      36,
    )} 18 18, pointer`,
  );
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    icon.href = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='${light}'/><path d='M77.85 30.5A34 34 0 1 0 77.85 69.5' fill='none' stroke='${dark}' stroke-width='16'/><circle cx='50' cy='50' r='9' fill='${dark}'/></svg>`,
    )}`;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cs.getPropertyValue('--bg').trim());
}

/** Re-apply after the router swaps <html> attributes. */
export function applyPalette() {
  const p = current();
  if (p === 'citrus') delete root.dataset.palette;
  else root.dataset.palette = p;
  syncAssets();
}

/**
 * Switch to a random different pair. The colours themselves glide over via
 * the CSS transition on --light/--dark; the assets that can't read CSS
 * variables (cursor, favicon) follow once it settles.
 */
export function nextPalette() {
  const now = current();
  const others = PALETTES.filter((p) => p !== now);
  write(KEY, others[Math.floor(Math.random() * others.length)]);
  write(SINCE, String(Date.now()));
  applyPalette();
  setTimeout(syncAssets, reduced ? 0 : 1650);
}

/**
 * Rotate every EVERY_MS while the tab is visible, never mid page-transition.
 * The clock is kept in sessionStorage so navigating doesn't reset it.
 */
export function startRotation(isBusy: () => boolean) {
  applyPalette();
  if (reduced) return;
  if (!read(SINCE)) write(SINCE, String(Date.now()));
  setInterval(() => {
    if (document.hidden || isBusy()) return;
    if (Date.now() - Number(read(SINCE) ?? 0) >= EVERY_MS) nextPalette();
  }, 1000);
}
