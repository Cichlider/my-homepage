import { gsap } from 'gsap';
import { finePointer, reduced } from './scroll';

/**
 * Header menu: a pill that, on hover (or click/tap), stretches leftwards into
 * a single row (links + language / palette / invert); it stays within the
 * header's height.
 */
export function initMenu() {
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!menu) return { close: () => {} };
  const toggle = menu.querySelector<HTMLButtonElement>('.menu__toggle')!;
  const panel = menu.querySelector<HTMLElement>('.menu__panel')!;
  const bg = menu.querySelector<HTMLElement>('.menu__bg')!;
  const items = menu.querySelectorAll<HTMLElement>('[data-menu-item]');
  let open = false;
  let timer = 0;

  const pill = () => ({ width: toggle.offsetWidth, height: toggle.offsetHeight, borderRadius: toggle.offsetHeight / 2 });
  // The panel reserves room for the pill at its right end.
  const syncToggleWidth = () => menu.style.setProperty('--toggle-w', `${toggle.offsetWidth}px`);
  syncToggleWidth();
  gsap.set(bg, pill());
  gsap.set(items, { visibility: 'hidden' });
  // Label width changes with language; keep the closed pill hugging it.
  new ResizeObserver(() => {
    syncToggleWidth();
    if (!open) gsap.set(bg, pill());
  }).observe(toggle);

  const show = () => {
    clearTimeout(timer);
    if (open) return;
    open = true;
    menu.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    panel.inert = false;
    const d = reduced ? 0 : 1;
    const h = panel.offsetHeight;
    gsap.to(bg, { width: panel.offsetWidth, height: h, borderRadius: Math.min(h / 2, 23), duration: 0.6 * d, ease: 'expo.out', overwrite: true });
    gsap.fromTo(
      items,
      { visibility: 'visible', x: 16, clipPath: 'inset(0% 0% 0% 100%)' },
      { x: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6 * d, ease: 'expo.out', stagger: { each: 0.04, from: 'end' }, delay: 0.08 * d, overwrite: true, onComplete: () => gsap.set(items, { clearProps: 'clipPath' }) },
    );
  };

  const hide = () => {
    clearTimeout(timer);
    if (!open) return;
    open = false;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    panel.inert = true;
    const d = reduced ? 0 : 1;
    gsap.to(items, { x: 10, clipPath: 'inset(0% 0% 0% 100%)', duration: 0.25 * d, ease: 'power2.in', overwrite: true, onComplete: () => gsap.set(items, { visibility: 'hidden' }) });
    gsap.to(bg, { ...pill(), duration: 0.6 * d, ease: 'expo.inOut', delay: 0.08 * d, overwrite: true });
  };

  if (finePointer) {
    menu.addEventListener('pointerenter', show);
    menu.addEventListener('pointerleave', () => (timer = window.setTimeout(hide, 260)));
  }
  toggle.addEventListener('click', () => (open && !finePointer ? hide() : show()));
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      hide();
      toggle.focus();
    }
  });
  menu.addEventListener('focusout', (e) => {
    if (!menu.contains(e.relatedTarget as Node | null)) hide();
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.menu__link')) hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (open && !menu.contains(e.target as Node)) hide();
  });

  return { close: hide };
}
