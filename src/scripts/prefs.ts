import { dict, type Key, type Lang } from '../i18n/dict';
import { reduced } from './scroll';

const LANG_KEY = 'cichlid:lang';
const THEME_KEY = 'cichlid:theme';
const root = document.documentElement;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference lasts for this page only */
  }
}

// Language ---------------------------------------------------------------

export function storedLang(): Lang {
  const v = read(LANG_KEY);
  if (v === 'en' || v === 'zh') return v;
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

export const currentLang = (): Lang => (root.lang === 'zh-CN' ? 'zh' : 'en');

export function t(key: string): string {
  return dict[currentLang()][key as Key] ?? key;
}

export function applyLang(lang: Lang = storedLang()) {
  root.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const value = dict[lang][el.dataset.i18n as Key];
    if (value != null) el.textContent = value;
  });
  document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
}

export function setLang(lang: Lang) {
  write(LANG_KEY, lang);
  applyLang(lang);
}

// Theme (yellow-on-violet ↔ violet-on-yellow) ----------------------------

const isInverted = () => root.dataset.theme === 'inv';

export function applyTheme() {
  const v = read(THEME_KEY);
  const inv = v ? v === 'inv' : matchMedia('(prefers-color-scheme: dark)').matches;
  setThemeAttr(inv);
}

function setThemeAttr(inv: boolean) {
  if (inv) root.dataset.theme = 'inv';
  else delete root.dataset.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
}

/** Invert colours with a circular wipe that grows from `origin`. */
export function toggleTheme(origin: HTMLElement) {
  const next = !isInverted();
  const swap = () => {
    setThemeAttr(next);
    write(THEME_KEY, next ? 'inv' : 'base');
  };
  if (reduced || !document.startViewTransition) return swap();

  const r = origin.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(swap);
  vt.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 900, easing: 'cubic-bezier(.76,0,.24,1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}
