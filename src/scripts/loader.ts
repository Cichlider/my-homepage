import { gsap } from 'gsap';
import { lenis, reduced } from './scroll';
import { hold, uncover } from './curtain';

// Awaiting a GSAP tween directly never settles (it resolves with itself).
const done = (anim: gsap.core.Animation) =>
  new Promise<void>((resolve) => anim.eventCallback('onComplete', () => resolve()));

const pageLoaded = () =>
  new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else addEventListener('load', () => resolve(), { once: true });
  });

/**
 * First-visit loader: the mark draws itself as a 000→100 counter tracks real
 * readiness (fonts + window load). It then hands over to the transition
 * curtain — same colour, same mark, same place — and the page arrives over it
 * as a card. Resolves as the card nears its place so the intro can overlap it.
 */
export async function runLoader(): Promise<void> {
  const root = document.getElementById('loader');
  if (!root) return;
  lenis.stop();

  const count = root.querySelector<HTMLElement>('[data-count]')!;
  const arc = root.querySelector<SVGPathElement>('.mark__arc')!;
  const eye = root.querySelector<SVGCircleElement>('.mark__eye')!;
  const state = { p: 0 };
  const render = () => {
    count.textContent = String(Math.round(state.p)).padStart(3, '0');
    arc.style.strokeDashoffset = String(1 - state.p / 100);
  };
  gsap.set(eye, { scale: 0, transformOrigin: '50% 50%' });

  const ready = Promise.all([document.fonts.ready, pageLoaded()]);
  if (reduced) {
    await ready;
  } else {
    // Creep towards 85 while waiting, then finish once everything is in.
    const creep = gsap.to(state, { p: 85, duration: 1.6, ease: 'power2.out', onUpdate: render });
    await Promise.all([ready, done(creep)]);
    await done(gsap.to(state, { p: 100, duration: 0.45, ease: 'power2.inOut', onUpdate: render }));
    await done(gsap.to(eye, { scale: 1, duration: 0.45, ease: 'back.out(3)' }));
    await done(gsap.to(root.querySelector('.loader__foot'), { yPercent: 40, clipPath: 'inset(0% 0% 100% 0%)', duration: 0.45, ease: 'power3.in' }));
  }
  state.p = 100;
  render();

  hold();
  root.remove();
  uncover();
  await new Promise((r) => gsap.delayedCall(reduced ? 0 : 0.7, r));
}
