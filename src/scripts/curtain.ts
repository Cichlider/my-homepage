import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { lenis, reduced, EASE } from './scroll';
import { Ink, cssColor, type Circle } from './ink';

/**
 * Page transition, shot like a camera move:
 *  1. cover — the camera pushes into the old page towards where you clicked
 *     while ink bursts out of that point and floods the screen;
 *  2. uncover — the new page arrives as a card from below, tilted in
 *     perspective, overlapping the ink, and settles flat as the mark is
 *     pushed up and away behind it (parallax), then the header drops in.
 * Without WebGL the ink is a plain panel; with reduced motion, a fade.
 */

const el = () => document.getElementById('curtain')!;
const parts = () => {
  const c = el();
  return { c, mark: c.querySelector<SVGSVGElement>('.mark')!, arc: c.querySelector<SVGPathElement>('.mark__arc')! };
};

let ink: Ink | null | undefined;
let origin: { x: number; y: number } | null = null;
addEventListener('pointerdown', (e) => (origin = { x: e.clientX, y: e.clientY }), { capture: true });

function getInk() {
  if (ink === undefined) {
    const canvas = el().querySelector('canvas');
    ink = !reduced && canvas ? Ink.create(canvas) : null;
    if (ink) el().classList.add('is-ink');
  }
  ink?.resize(innerWidth, innerHeight);
  return ink;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const outExpo = gsap.parseEase('expo.out');
const outCubic = gsap.parseEase('power3.out');
const outBack = gsap.parseEase('back.out(1.7)');
const inQuad = gsap.parseEase('power2.in');

const paint = (gl: Ink, blobs: Circle[], cover: number) => gl.draw({ blobs, cover, ink: cssColor(el(), '--bg') });

/** Flood the screen. Resolves once fully covered. */
export function cover(): Promise<void> {
  const { c, mark, arc } = parts();
  lenis.stop();
  gsap.killTweensOf([c, mark, arc]);
  const gl = getInk();

  return new Promise((resolve) => {
    if (reduced) {
      if (gl) paint(gl, [], 2);
      gsap.fromTo(c, { autoAlpha: 0, yPercent: 0 }, { autoAlpha: 1, duration: 0.2, onComplete: resolve });
      return;
    }
    const tl = gsap.timeline({ onComplete: resolve });
    if (!gl) {
      tl.set(c, { autoAlpha: 1, yPercent: 100 }).to(c, { yPercent: 0, duration: 0.75, ease: EASE });
    } else {
      const W = innerWidth;
      const H = innerHeight;
      const D = Math.hypot(W, H);
      const o = origin ?? { x: W / 2, y: H / 2 };
      origin = null;
      const sats = Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + rand(-0.2, 0.2);
        return { dx: Math.cos(a), dy: Math.sin(a), dist: D * rand(0.15, 0.55), size: D * rand(0.03, 0.075), lag: rand(0, 0.3) };
      });
      const state = { p: 0 };
      const frame = () => {
        const p = state.p;
        const blobs: Circle[] = [{ x: o.x, y: o.y, r: D * (0.08 * outExpo(Math.min(p * 2.5, 1)) + 0.5 * p * p * p) }];
        for (const s of sats) {
          const q = clamp01((p - s.lag) / (1 - s.lag));
          const d = s.dist * outCubic(q);
          blobs.push({ x: o.x + s.dx * d, y: o.y + s.dy * d, r: s.size * outBack(q) * (1 + p) });
        }
        paint(gl, blobs, 1.6 * smooth(0.55, 1, p));
      };
      gsap.set(c, { autoAlpha: 1, yPercent: 0 });
      gsap.set(mark, { autoAlpha: 0 });
      frame();
      const page = document.getElementById('page');
      if (page) {
        tl.to(page, { scale: 1.1, transformOrigin: `${o.x}px ${o.y + scrollY}px`, duration: 1, ease: 'power2.in' }, 0);
      }
      tl.to(state, { p: 1, duration: 0.9, ease: 'none', onUpdate: frame });
    }
    tl.fromTo(mark, { autoAlpha: 0, rotate: -90, scale: 0.5, y: 0 }, { autoAlpha: 1, rotate: 0, scale: 1, duration: 0.6, ease: 'expo.out' }, gl ? 0.6 : 0.35).fromTo(
      arc,
      { strokeDashoffset: 1 },
      { strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut' },
      '<-0.05',
    );
  });
}

/** Show the curtain fully covered with no animation (used for the loader hand-off). */
export function hold() {
  const { c, mark, arc } = parts();
  lenis.stop();
  const gl = getInk();
  if (gl) paint(gl, [], 2);
  gsap.set(c, { autoAlpha: 1, yPercent: 0 });
  gsap.set(mark, { autoAlpha: 1, rotate: 0, scale: 1, y: 0 });
  gsap.set(arc, { strokeDashoffset: 0 });
}

/** Bring the new page in as a card over the ink. */
export function uncover(): Promise<void> {
  const { c, mark } = parts();
  const page = document.getElementById('page');
  const header = document.getElementById('header');
  const finish = () => {
    gsap.set(c, { autoAlpha: 0 });
    gsap.set(mark, { clearProps: 'transform' });
    if (page) gsap.set(page, { clearProps: 'all' });
    if (header) gsap.set(header, { clearProps: 'transform' });
    ink?.clear();
    lenis.start();
    ScrollTrigger.refresh();
  };

  return new Promise((resolve) => {
    if (reduced || !page) {
      gsap.to(c, { autoAlpha: 0, duration: 0.2, onComplete: () => (finish(), resolve()) });
      return;
    }
    const H = innerHeight;
    gsap.set(page, { zIndex: 95, overflow: 'hidden', transformPerspective: 1600, transformOrigin: `50% ${H / 2}px` });
    gsap
      .timeline({ onComplete: () => (finish(), resolve()) })
      .fromTo(
        page,
        { y: H * 1.02, scale: 0.82, rotateX: 18, borderRadius: 56 },
        { y: 0, scale: 1, rotateX: 0, borderRadius: 0, duration: 1.15, ease: 'expo.inOut' },
        0,
      )
      .to(mark, { y: -H * 0.32, scale: 0.55, rotate: -45, duration: 1.05, ease: 'expo.inOut' }, 0.02)
      .fromTo(header, { yPercent: -130 }, { yPercent: 0, duration: 0.8, ease: 'expo.out' }, 0.95);
  });
}
