import { gsap } from 'gsap';
import { finePointer } from './scroll';
import { t } from './prefs';

/**
 * The pointer itself is the OS cursor (a CSS `cursor: url()` image, see
 * global.css): drawn by the system, so it never lags and never disappears.
 * This element is only the label bubble ("View", "Open") that grows around
 * it over `[data-cursor]` targets.
 */

let el: HTMLElement | null = null;

export function initCursor() {
  el = document.getElementById('cursor');
  if (!el || !finePointer) return;
  const bubble = el;
  const label = bubble.querySelector<HTMLElement>('.cursor__label')!;
  const xTo = gsap.quickTo(bubble, 'x', { duration: 0.12, ease: 'power2' });
  const yTo = gsap.quickTo(bubble, 'y', { duration: 0.12, ease: 'power2' });

  addEventListener('pointermove', (e) => {
    xTo(e.clientX);
    yTo(e.clientY);
  });
  document.addEventListener('pointerover', (e) => {
    const target = e.target as Element;
    const labelled = target.closest<HTMLElement>('[data-cursor]');
    bubble.dataset.state = labelled ? 'label' : '';
    if (labelled) label.textContent = t(labelled.dataset.cursor!);
    bubble.dataset.tone = target.closest('[data-tone="inv"]') ? 'inv' : '';
  });
  document.documentElement.addEventListener('pointerleave', () => (bubble.dataset.state = ''));
}

export function resetCursor() {
  if (el) el.dataset.state = '';
}
