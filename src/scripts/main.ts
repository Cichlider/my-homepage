import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { lenis } from './scroll';
import { applyLang, applyTheme, currentLang, setLang, toggleTheme } from './prefs';
import type { Lang } from '../i18n/dict';
import { cover, uncover } from './curtain';
import { runLoader } from './loader';
import { initCursor, resetCursor } from './cursor';
import { initMenu } from './menu';
import { applyPalette, nextPalette, startRotation } from './palette';
import { initPage, destroyPage } from './page';

let firstLoad = true;
let busy = false;

/** Cover → change something → rebuild → reveal. Shared by language switching. */
async function withCurtain(change: () => void) {
  if (busy) return;
  busy = true;
  await cover();
  destroyPage();
  change();
  const play = initPage();
  uncover();
  setTimeout(play, 700);
  busy = false;
}

function syncNav() {
  const here = location.pathname.replace(/\/$/, '');
  document.querySelectorAll<HTMLAnchorElement>('.menu__link').forEach((a) => {
    const current = !a.hash && a.pathname.replace(/\/$/, '') === here;
    if (current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// Router lifecycle ---------------------------------------------------------

initCursor();
const menu = initMenu();
startRotation(() => busy || document.getElementById('curtain')?.style.visibility === 'visible');

document.addEventListener('astro:before-preparation', (e) => {
  menu.close();
  const event = e as TransitionBeforePreparationEvent;
  const load = event.loader;
  event.loader = async () => {
    await Promise.all([cover(), load()]);
  };
});

document.addEventListener('astro:before-swap', (e) => {
  destroyPage();
  // The loader only ever plays on the first visit.
  (e as TransitionBeforeSwapEvent).newDocument.getElementById('loader')?.remove();
});

document.addEventListener('astro:after-swap', () => {
  applyTheme();
  applyPalette();
  applyLang();
  const target = location.hash ? document.querySelector<HTMLElement>(location.hash) : null;
  lenis.scrollTo(target ?? 0, { immediate: true, force: true });
});

document.addEventListener('astro:page-load', async () => {
  syncNav();
  resetCursor();
  if (firstLoad) {
    firstLoad = false;
    applyLang();
    const play = initPage();
    await runLoader();
    play();
  } else {
    const play = initPage();
    uncover();
    setTimeout(play, 700);
  }
});

// Global interactions (header and cursor persist across pages) ------------

const header = document.getElementById('header');
lenis.on('scroll', ({ scroll, direction }) => {
  header?.classList.toggle('is-solid', scroll > 24);
  header?.classList.toggle('is-hidden', scroll > 240 && direction === 1);
});

document.addEventListener(
  'click',
  (e) => {
    const target = e.target as Element;

    const action = target.closest<HTMLElement>('[data-action]');
    if (action) {
      const kind = action.dataset.action;
      const lang = action.dataset.lang as Lang | undefined;
      if (kind === 'lang' && lang && lang !== currentLang()) {
        menu.close();
        withCurtain(() => setLang(lang));
      }
      if (kind === 'theme') toggleTheme(action);
      if (kind === 'palette') nextPalette();
      if (kind === 'top') lenis.scrollTo(0, { duration: 1.6 });
      return;
    }

    // Same-page anchors scroll smoothly instead of jumping (capture phase, so
    // the router sees defaultPrevented and leaves them alone).
    const a = target.closest('a');
    if (!a || !a.hash || a.origin !== location.origin) return;
    if (a.pathname.replace(/\/$/, '') !== location.pathname.replace(/\/$/, '')) return;
    const dest = document.querySelector<HTMLElement>(a.hash);
    if (!dest) return;
    e.preventDefault();
    lenis.scrollTo(dest, { duration: 1.4 });
  },
  true,
);
