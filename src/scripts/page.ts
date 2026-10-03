import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { lenis, reduced, finePointer } from './scroll';
import { heroInk } from './hero';

/**
 * Per-page motion. Everything created here is torn down by destroyPage()
 * before the router swaps pages (or the language changes), so the next
 * initPage() always starts from clean DOM.
 */

const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

let ctx: gsap.Context | null = null;
let splits: SplitText[] = [];
let cleanups: Array<() => void> = [];
const onCleanup = (fn: () => void) => cleanups.push(fn);

/** Build the page's animations; returns a function that plays the intro. */
export function initPage(): () => void {
  const intro = gsap.timeline({ paused: true });
  ctx = gsap.context(() => {
    fitText();
    introAnimations(intro);
    scrollReveals();
    headerTone();
    marquees();
    eyes();
    magnetic();
    arena();
    footerWord();
  });
  heroInk(onCleanup);

  let timer = 0;
  const onResize = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      fitText();
      ScrollTrigger.refresh();
    }, 150);
  };
  addEventListener('resize', onResize);
  onCleanup(() => removeEventListener('resize', onResize));

  ScrollTrigger.refresh();
  return () => (reduced ? intro.progress(1) : intro.play());
}

export function destroyPage() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  splits.forEach((s) => s.revert());
  splits = [];
  ctx?.revert();
  ctx = null;
  const header = document.getElementById('header');
  if (header) header.dataset.tone = '';
}

function split(el: HTMLElement, vars: Partial<SplitText.Vars> = {}) {
  const s = SplitText.create(el, { type: 'lines', mask: 'lines', ...vars });
  splits.push(s);
  return s;
}

function introAnimations(tl: gsap.core.Timeline) {
  const introSplits: SplitText[] = [];
  $$('[data-intro="lines"]').forEach((el, i) => {
    const s = split(el);
    introSplits.push(s);
    tl.from(s.lines, { yPercent: 115, duration: 1.25, ease: 'expo.out', stagger: 0.09 }, i * 0.12);
  });
  $$('[data-intro="mark"]').forEach((el) => {
    tl.from(el, { scale: 0, rotate: -140, duration: 1.5, ease: 'expo.out' }, 0.05);
  });
  const fades = $$('[data-intro="fade"]');
  // Clip-and-slide rather than fade: a half-transparent frame would mix a third colour.
  if (fades.length) tl.from(fades, { yPercent: 60, clipPath: 'inset(0% 0% 100% 0%)', duration: 1, ease: 'expo.out', stagger: 0.06 }, 0.35);
  // Unwrap the line masks once in place so text reflows naturally on resize.
  tl.eventCallback('onComplete', () => {
    introSplits.forEach((s) => s.revert());
    document.dispatchEvent(new Event('intro:done'));
  });
}

function scrollReveals() {
  $$('[data-reveal="lines"]').forEach((el) => {
    split(el, {
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 115,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        }),
    });
  });
  $$('[data-reveal="up"]').forEach((el) => {
    gsap.from(el, {
      y: 36,
      clipPath: 'inset(0% 0% 100% 0%)',
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
    });
  });
  $$('[data-reveal="rule"]').forEach((el) => {
    gsap.from(el, {
      scaleX: 0,
      transformOrigin: '0% 50%',
      duration: 1.3,
      ease: 'expo.inOut',
      scrollTrigger: { trigger: el, start: 'top 95%', once: true },
    });
  });
}

/** Flip the fixed header's colours while it sits over a violet band. */
function headerTone() {
  const header = document.getElementById('header');
  if (!header) return;
  const line = Math.round(header.offsetHeight / 2);
  const active = new Set<Element>();
  $$('main [data-tone="inv"], footer[data-tone="inv"]').forEach((band) => {
    ScrollTrigger.create({
      trigger: band,
      start: `top ${line}`,
      end: `bottom ${line}`,
      onToggle: (self) => {
        if (self.isActive) active.add(band);
        else active.delete(band);
        header.dataset.tone = active.size ? 'inv' : '';
      },
    });
  });
}

/** Endless marquee that speeds up with scroll velocity. */
function marquees() {
  $$('[data-marquee]').forEach((m) => {
    const track = m.querySelector('.marquee__track');
    if (!track || reduced) return;
    const loop = gsap.to(track, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 });
    const boost = gsap.timeline();
    const off = lenis.on('scroll', ({ velocity }) => {
      const speed = 1 + Math.min(Math.abs(velocity) * 0.35, 7);
      boost.clear().to(loop, { timeScale: speed, duration: 0.2 }).to(loop, { timeScale: 1, duration: 1.4, ease: 'power2.out' });
    });
    onCleanup(off);
  });
}

/** The mark's eye follows the pointer, and blinks now and then. */
function eyes() {
  const items = $$<SVGCircleElement>('[data-eye] .mark__eye').map((eye) => ({
    svg: eye.ownerSVGElement!,
    x: gsap.quickTo(eye, 'x', { duration: 0.7, ease: 'power3' }),
    y: gsap.quickTo(eye, 'y', { duration: 0.7, ease: 'power3' }),
    eye,
  }));
  if (!items.length) return;
  const move = (e: PointerEvent) =>
    items.forEach(({ svg, x, y }) => {
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(d / (r.width * 1.5), 1) * 9;
      x((dx / d) * reach);
      y((dy / d) * reach);
    });
  addEventListener('pointermove', move);
  onCleanup(() => removeEventListener('pointermove', move));
  if (reduced) return;
  items.forEach(({ eye }, i) => {
    gsap
      .timeline({ repeat: -1, repeatDelay: 3.4 + i * 0.7, delay: 2 })
      .to(eye, { scaleY: 0.1, transformOrigin: '50% 50%', duration: 0.08, ease: 'power1.in' })
      .to(eye, { scaleY: 1, duration: 0.12, ease: 'power1.out' });
  });
}

function magnetic() {
  if (!finePointer || reduced) return;
  $$('[data-magnetic]').forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
    const y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
    const host = el.closest('a, button') ?? el;
    const move = (e: Event) => {
      const { clientX, clientY } = e as PointerEvent;
      const r = el.getBoundingClientRect();
      x((clientX - r.left - r.width / 2) * 0.35);
      y((clientY - r.top - r.height / 2) * 0.35);
    };
    const leave = () => {
      x(0);
      y(0);
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    onCleanup(() => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    });
  });
}

/** Killfield preview: two tanks circle their halves of the maze, joined by a sight line. */
function arena() {
  $$<SVGSVGElement>('[data-arena]').forEach((svg) => {
    const tanks = $$<SVGGElement>('[data-tank]', svg);
    const sight = svg.querySelector<SVGLineElement>('[data-sight]');
    tanks.forEach((tank, i) => {
      const path = svg.querySelector<SVGPathElement>(tank.dataset.tank!);
      if (!path) return;
      const tween = gsap.to(tank, {
        motionPath: { path, autoRotate: true },
        duration: 11 + i * 3,
        repeat: -1,
        ease: 'none',
      });
      if (i === 1) tween.progress(0.5);
      if (reduced) tween.pause();
    });
    if (!sight || tanks.length < 2) return;
    // The centre wall (x=800, y 340–560) breaks line of sight.
    const update = () => {
      const [x1, y1, x2, y2] = [
        gsap.getProperty(tanks[0], 'x'),
        gsap.getProperty(tanks[0], 'y'),
        gsap.getProperty(tanks[1], 'x'),
        gsap.getProperty(tanks[1], 'y'),
      ].map(Number);
      const yAtWall = y1 + ((800 - x1) / (x2 - x1)) * (y2 - y1);
      sight.classList.toggle('is-blocked', yAtWall > 325 && yAtWall < 575);
      sight.setAttribute('x1', String(x1));
      sight.setAttribute('y1', String(y1));
      sight.setAttribute('x2', String(x2));
      sight.setAttribute('y2', String(y2));
    };
    gsap.ticker.add(update);
    onCleanup(() => gsap.ticker.remove(update));
  });
}

/** Scale `[data-fit]` text to exactly fill its parent's width. */
function fitText() {
  $$('[data-fit]').forEach((el) => {
    el.style.fontSize = '100px';
    const width = el.parentElement!.clientWidth;
    el.style.fontSize = `${(100 * width) / el.getBoundingClientRect().width}px`;
  });
}

function footerWord() {
  const word = document.querySelector('.footer__word');
  if (!word || reduced) return;
  gsap.from(word, {
    yPercent: 70,
    ease: 'none',
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });
}
