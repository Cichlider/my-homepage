import { gsap } from 'gsap';
import type * as T from 'three';
import { MAX_BLOBS, cssColor } from './ink';
import { reduced } from './scroll';

/**
 * Hero ink: the pointer drags a gooey trail, a click throws a splat with
 * flying droplets and running drips, and it all dries away. Under the ink the
 * hero's text is inverted, and where the ink crosses the mark it opens a
 * window onto the mark's real 3D model — a bevelled, extruded "C" holding an
 * eyeball that watches the pointer — cel-shaded in the same two colours.
 */

interface Drop {
  x: number;
  y: number;
  r: number;
  r0: number;
  vx: number;
  vy: number;
  drag: number;
  g: number;
  run: number;
  ran: number;
  age: number;
  life: number;
  grow: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const backOut = gsap.parseEase('back.out(2.2)');
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Shaders -------------------------------------------------------------------

const TOON_VERT = `precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vN;
out vec3 vObjN;
void main() {
  vN = normalize(normalMatrix * normal);
  vObjN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Two-colour cel shading with a hard terminator; eyes get iris, pupil, glint.
const TOON_FRAG = `precision highp float;
uniform vec3 uFg;
uniform vec3 uBg;
uniform int uKind;
in vec3 vN;
in vec3 vObjN;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.55, 0.65, 0.75));
  vec3 col = dot(n, L) > 0.18 ? uBg : uFg;
  // Ink line where the surface turns away: traces bevels and the eyeball rim.
  if (abs(n.z) > 0.2 && abs(n.z) < 0.62) col = uFg;
  if (uKind == 1) {
    float z = normalize(vObjN).z;
    if (z > 0.78) col = uFg;
    if (z > 0.86 && z < 0.9) col = uBg;
  }
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  if (pow(max(dot(n, H), 0.0), 90.0) > 0.5) col = uBg;
  o = vec4(col, 1.0);
}`;

const QUAD_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMP_FRAG = `precision highp float;
#define MAX ${MAX_BLOBS}
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uBlobs[MAX];
uniform int uCount;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform sampler2D uScene;
uniform sampler2D uText;
uniform float uHasText;
uniform sampler2D uBrand;
uniform vec4 uBrandRect;
uniform vec4 uMenu;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;

  // Ink field (compact kernel: value 1 at d = r, support 2r).
  float f = 0.0;
  for (int i = 0; i < MAX; i++) {
    if (i >= uCount) break;
    vec4 b = uBlobs[i];
    if (b.z < 0.5) continue;
    vec2 d = p - b.xy;
    float k = max(1.0 - dot(d, d) / (4.0 * b.z * b.z), 0.0);
    f += k * k * k * 2.370370;
  }
  f = min(f, 2.0);
  float w = clamp(fwidth(f), 1e-4, 0.5);
  float ink = smoothstep(1.0 - w, 1.0 + w, f);

  // The canvas sits above the header; let the ink pass under the menu pill,
  // which gets a paper-coloured rim where it sits in ink so it stays legible.
  float rim = 0.0;
  if (uMenu.z > 0.0) {
    vec2 hb = uMenu.zw * 0.5;
    float rr = min(hb.x, hb.y);
    vec2 q = abs(p - uMenu.xy - hb) - hb + rr;
    float md = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
    rim = smoothstep(-0.75, 0.75, md) * (1.0 - smoothstep(2.25, 3.75, md));
    ink *= smoothstep(-0.75, 0.75, md);
  }
  if (ink <= 0.0) { o = vec4(0.0); return; }

  // Ink, then the 3D models (premultiplied) with a paper-coloured outline so
  // its shadowed sides don't dissolve into the ink; then text inverts it all.
  vec2 suv = gl_FragCoord.xy / (uRes * uDpr);
  vec4 sc = texture(uScene, suv);
  vec2 px = 3.5 / (uRes * uDpr) * uDpr;
  float near = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    near = max(near, texture(uScene, suv + vec2(cos(a), sin(a)) * px).a);
  }
  vec3 col = mix(uInk, uPaper, max(near - sc.a, 0.0));
  col = col * (1.0 - sc.a) + sc.rgb;
  float text = uHasText > 0.5 ? texture(uText, vec2(p.x / uRes.x, 1.0 - p.y / uRes.y)).a : 0.0;
  // The header wordmark lives in its own small mask (it moves with the header).
  vec2 bu = (p - uBrandRect.xy) / max(uBrandRect.zw, vec2(1.0));
  if (uBrandRect.z > 0.0 && all(greaterThanEqual(bu, vec2(0.0))) && all(lessThanEqual(bu, vec2(1.0)))) {
    text = max(text, texture(uBrand, vec2(bu.x, 1.0 - bu.y)).a);
  }
  col = mix(col, uInk + uPaper - col, text);
  col = mix(col, uPaper, rim);
  o = vec4(col, 1.0) * ink;
}`;

// ---------------------------------------------------------------------------

export function heroInk(onCleanup: (fn: () => void) => void) {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero || reduced) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero__ink';
  canvas.setAttribute('aria-hidden', 'true');
  hero.append(canvas);

  let stop: (() => void) | null = null;
  let dead = false;
  onCleanup(() => {
    dead = true;
    stop?.();
    canvas.remove();
  });
  Promise.all([import('three'), import('three/examples/jsm/utils/BufferGeometryUtils.js')])
    .then(([THREE, utils]) => {
      if (!dead) stop = start(THREE, utils.toCreasedNormals, hero, canvas);
    })
    .catch(() => canvas.remove());
}

function start(
  THREE: typeof T,
  toCreasedNormals: (geo: T.BufferGeometry, creaseAngle?: number) => T.BufferGeometry,
  hero: HTMLElement,
  canvas: HTMLCanvasElement,
): () => void {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
  } catch {
    return () => {};
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const fg = new THREE.Vector3();
  const bg = new THREE.Vector3();
  const readColors = () => {
    fg.fromArray(cssColor(hero, '--fg'));
    bg.fromArray(cssColor(hero, '--bg'));
  };
  readColors();

  const markSvg = hero.querySelector<SVGSVGElement>('.hero__mark svg');

  // 3D world (orthographic, 1 unit = 1 CSS px, y up) ---------------------------
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
  const toon = (kind: number) =>
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TOON_VERT,
      fragmentShader: TOON_FRAG,
      uniforms: { uFg: { value: fg }, uBg: { value: bg }, uKind: { value: kind } },
    });
  const ringMat = toon(0);
  const eyeMat = toon(1);

  // The mark, modelled in its own units (Mark.astro: ring r 34, stroke 16,
  // 70° mouth): an annular sector extruded with a soft bevel.
  const mouth = (35 / 180) * Math.PI;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 42, mouth, Math.PI * 2 - mouth, false);
  shape.absarc(0, 0, 26, Math.PI * 2 - mouth, mouth, true);
  shape.closePath();
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: 16,
    bevelEnabled: true,
    bevelThickness: 4,
    bevelSize: 3.2,
    bevelSegments: 6,
    curveSegments: 72,
  });
  extruded.translate(0, 0, -8);
  // Smooth across the curved walls and bevel steps, crisp at the real corners.
  const ringGeo = toCreasedNormals(extruded, (40 / 180) * Math.PI);
  extruded.dispose();

  const eyeGeo = new THREE.SphereGeometry(1, 64, 48);
  const makeModel = () => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.z = 6;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(ringGeo, ringMat), eye);
    scene.add(group);
    return { group, eye };
  };
  // One model under the hero mark, a small twin under the header logo.
  const models = [
    { ...makeModel(), svg: markSvg },
    { ...makeModel(), svg: document.querySelector<SVGSVGElement>('.brand__mark svg') },
  ];

  // Compositor ---------------------------------------------------------------
  const blobData = new Float32Array(MAX_BLOBS * 4);
  const textCanvas = document.createElement('canvas');
  const textTex = new THREE.CanvasTexture(textCanvas);
  textTex.generateMipmaps = false;
  textTex.minFilter = THREE.LinearFilter;
  const brandWord = document.querySelector<HTMLElement>('.brand__word');
  const brandCanvas = document.createElement('canvas');
  const brandTex = new THREE.CanvasTexture(brandCanvas);
  brandTex.generateMipmaps = false;
  brandTex.minFilter = THREE.LinearFilter;
  const BRAND_PAD = 6;
  const comp = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: QUAD_VERT,
    fragmentShader: COMP_FRAG,
    depthTest: false,
    uniforms: {
      uRes: { value: new THREE.Vector2() },
      uDpr: { value: dpr },
      uBlobs: { value: blobData },
      uCount: { value: 0 },
      uInk: { value: fg },
      uPaper: { value: bg },
      uScene: { value: rt.texture },
      uText: { value: textTex },
      uHasText: { value: 0 },
      uBrand: { value: brandTex },
      uBrandRect: { value: new THREE.Vector4() },
      uMenu: { value: new THREE.Vector4() },
    },
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), comp));
  const quadCam = new THREE.Camera();
  const u = comp.uniforms;

  // State --------------------------------------------------------------------
  const drops: Drop[] = [];
  const pointer = { x: -9999, y: -9999, sx: -9999, sy: -9999, amt: 0, target: 0 };
  let W = 1;
  let H = 1;
  let scale = 1;
  let maskDirty = true;
  let introDone = false;
  let visible = true;
  let busyUntil = 0;
  const poke = (ms = 700) => (busyUntil = Math.max(busyUntil, performance.now() + ms));

  const resize = () => {
    W = hero.clientWidth;
    H = hero.clientHeight;
    scale = Math.min(Math.max(W / 1440, 0.55), 1.25);
    renderer.setSize(W, H, false);
    rt.setSize(Math.round(W * dpr), Math.round(H * dpr));
    cam.right = W;
    cam.bottom = -H;
    cam.updateProjectionMatrix();
    u.uRes.value.set(W, H);
    maskDirty = true;
    poke();
  };
  resize();

  /** Draw every visible character under `root` at its DOM position, relative to `origin`. */
  const rasterise = (root: HTMLElement, target: HTMLCanvasElement, origin: { left: number; top: number }, w: number, h: number) => {
    const ctx = target.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const el = text.parentElement;
      if (!el || !text.data.trim() || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText('Hg');
      const asc = m.fontBoundingBoxAscent;
      const desc = m.fontBoundingBoxDescent;
      const upper = cs.textTransform === 'uppercase';
      let i = 0;
      for (const ch of text.data) {
        if (ch.trim()) {
          range.setStart(text, i);
          range.setEnd(text, i + ch.length);
          // A glyph right after a line break also yields an empty box at the
          // end of the previous line; take the widest box.
          let r: DOMRect | undefined;
          for (const box of range.getClientRects()) if (!r || box.width > r.width) r = box;
          if (r?.width) {
            ctx.fillText(upper ? ch.toUpperCase() : ch, r.left - origin.left, r.top - origin.top + (r.height - asc - desc) / 2 + asc);
          }
        }
        i += ch.length;
      }
    }
  };

  const fit = (c: HTMLCanvasElement, tex: T.Texture, w: number, h: number) => {
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (c.width !== cw || c.height !== ch) {
      // A resized source needs fresh GPU storage, not a sub-image update.
      c.width = cw;
      c.height = ch;
      tex.dispose();
    }
  };

  const buildMask = () => {
    fit(textCanvas, textTex, W, H);
    rasterise(hero, textCanvas, hero.getBoundingClientRect(), W, H);
    textTex.needsUpdate = true;
    u.uHasText.value = 1;
    if (brandWord) {
      const r = brandWord.getBoundingClientRect();
      const w = r.width + BRAND_PAD * 2;
      const h = r.height + BRAND_PAD * 2;
      fit(brandCanvas, brandTex, w, h);
      rasterise(brandWord, brandCanvas, { left: r.left - BRAND_PAD, top: r.top - BRAND_PAD }, w, h);
      brandTex.needsUpdate = true;
    }
    maskDirty = false;
  };

  const add = (d: Partial<Drop> & Pick<Drop, 'x' | 'y' | 'r0'>) => {
    drops.push({ r: 0, vx: 0, vy: 0, drag: 6, g: 0, run: 0, ran: 0, age: 0, life: 6, grow: 0.15, ...d });
    // Over budget: drop whichever blob matters least (small and nearly dry),
    // never a splat's core.
    while (drops.length > MAX_BLOBS) {
      let worst = 0;
      let worstScore = Infinity;
      for (let i = 0; i < drops.length - 1; i++) {
        const score = drops[i].r0 * (drops[i].life - drops[i].age);
        if (score < worstScore) {
          worstScore = score;
          worst = i;
        }
      }
      drops.splice(worst, 1);
    }
  };

  const splat = (x: number, y: number, power = 1) => {
    // Well above the thickest trail blob (72px) so a click always reads as a splat.
    const R = rand(130, 175) * power * scale;
    const life = rand(6.5, 8);
    add({ x, y, r0: R, life, grow: 0.12 });
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2);
      const d = R * rand(0.35, 0.75);
      add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r0: R * rand(0.4, 0.7), life, grow: rand(0.12, 0.22) });
    }
    // Flung droplets: with drag k, launch speed d·k travels distance d.
    const n = Math.round(rand(16, 24));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
      const d = R * rand(1.15, 2.5);
      add({ x, y, vx: Math.cos(a) * d * 7, vy: Math.sin(a) * d * 7, drag: 7, r0: R * rand(0.05, 0.14), life: life - rand(0, 1), grow: 0.08 });
    }
    const drips = Math.round(rand(2, 4));
    for (let i = 0; i < drips; i++) {
      add({
        x: x + rand(-0.6, 0.6) * R,
        y: y + R * rand(0.45, 0.7),
        r0: R * rand(0.09, 0.14),
        g: rand(70, 150),
        run: rand(90, 260) * scale,
        drag: 0.6,
        life: life + 0.5,
        grow: 0.25,
      });
    }
  };

  // Pointer --------------------------------------------------------------------
  let last: { x: number; y: number; t: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = hero.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onMove = (e: PointerEvent) => {
    const p = local(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.target = 1;
    if (pointer.sx < -999) {
      pointer.sx = p.x;
      pointer.sy = p.y;
    }
    poke();
    const now = performance.now();
    if (!last) return void (last = { ...p, t: now });
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 20 * scale) return;
    const speed = dist / Math.max((now - last.t) / 1000, 0.008);
    const r0 = Math.min(Math.max(26 + speed * 0.03, 28), 72) * scale;
    const steps = Math.min(Math.max(Math.floor(dist / (24 * scale)), 1), 5);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      add({ x: last.x + (p.x - last.x) * k, y: last.y + (p.y - last.y) * k, r0, life: 1.5, grow: 0.08 });
    }
    last = { ...p, t: now };
  };
  const onLeave = () => {
    last = null;
    pointer.target = 0;
    poke(1200);
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('a, button')) return;
    const p = local(e);
    splat(p.x, p.y, rand(0.9, 1.2));
  };
  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', onLeave);
  hero.addEventListener('pointerdown', onDown);

  const markRect = (svg: SVGSVGElement | null = markSvg) => {
    if (!svg) return null;
    const m = svg.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    return { x: m.left - h.left + m.width / 2, y: m.top - h.top + m.height / 2, unit: m.width / 100 };
  };
  const menuBg = document.querySelector<HTMLElement>('.menu__bg');

  // After the intro, the first splat lands on the mark and opens the window onto its 3D model.
  const onIntro = () => {
    introDone = true;
    maskDirty = true;
    const m = markRect();
    if (m) gsap.delayedCall(0.4, () => splat(m.x - m.unit * 4, m.y + m.unit * 4, 1.1));
  };
  document.addEventListener('intro:done', onIntro, { once: true });

  const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  io.observe(hero);
  // Keep rendering through a palette/theme glide (1.6s) so the ink follows it.
  const mo = new MutationObserver(() => poke(1800));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
  const fontsDone = () => (maskDirty = true);
  document.fonts.addEventListener('loadingdone', fontsDone);
  addEventListener('resize', resize);

  // Frame ------------------------------------------------------------------------
  const target = new THREE.Vector3();
  const tick = (time: number, deltaMs: number) => {
    const dt = Math.min(deltaMs / 1000, 0.05);
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      if (d.age >= d.life) {
        drops.splice(i, 1);
        continue;
      }
      const decay = Math.exp(-d.drag * dt);
      d.vx *= decay;
      d.vy *= decay;
      if (d.g && d.ran < d.run) {
        d.vy = Math.min(d.vy + d.g * dt, 160);
        const step = d.vy * dt;
        d.ran += step;
        if (Math.floor((d.ran - step) / 14) !== Math.floor(d.ran / 14)) {
          add({ x: d.x + rand(-1, 1), y: d.y, r0: d.r0 * 0.72, life: d.life - d.age, grow: 0.01 });
        }
      } else if (d.g) {
        d.vy *= Math.exp(-8 * dt);
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.r = d.r0 * backOut(Math.min(d.age / d.grow, 1)) * (1 - smooth(d.life * 0.62, d.life, d.age));
    }

    const k = 1 - Math.exp(-dt * 10);
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;
    pointer.amt += (pointer.target - pointer.amt) * (1 - Math.exp(-dt * 4));

    if (!visible || (!drops.length && performance.now() > busyUntil)) return;
    if (maskDirty && introDone) buildMask();
    readColors();

    const m = markRect();
    const n = Math.min(drops.length, MAX_BLOBS);
    for (let i = 0; i < n; i++) {
      blobData[i * 4] = drops[i].x;
      blobData[i * 4 + 1] = drops[i].y;
      blobData[i * 4 + 2] = drops[i].r;
    }
    u.uCount.value = n;

    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const h = hero.getBoundingClientRect();
    if (brandWord) {
      const r = brandWord.getBoundingClientRect();
      u.uBrandRect.value.set(r.left - h.left - BRAND_PAD, r.top - h.top - BRAND_PAD, r.width + BRAND_PAD * 2, r.height + BRAND_PAD * 2);
    }
    if (menuBg) {
      const r = menuBg.getBoundingClientRect();
      u.uMenu.value.set(r.left - h.left, r.top - h.top, r.width, r.height);
    }

    if (n && m) {
      // Each model turns towards the pointer (or sways gently when it is
      // away), showing its depth; its eyeball looks right at it.
      const has = pointer.amt > 0.01;
      for (const model of models) {
        const r = markRect(model.svg);
        if (!r) continue;
        const px = has ? pointer.sx : r.x - W * 0.25 * Math.sin(time * 0.6);
        const py = has ? pointer.sy : r.y + H * 0.15 * Math.cos(time * 0.5);
        model.group.position.set(r.x, -r.y, 0);
        model.group.scale.setScalar(r.unit);
        model.group.rotation.set(
          Math.max(-0.55, Math.min(0.55, ((py - r.y) / H) * 1.1)),
          Math.max(-0.75, Math.min(0.75, ((px - r.x) / W) * 1.6)),
          0,
        );
        target.set(px, -py, 700);
        model.eye.lookAt(target);
        const domEye = model.svg?.querySelector('.mark__eye');
        const blink = domEye ? Number(gsap.getProperty(domEye, 'scaleY')) || 1 : 1;
        model.eye.scale.set(14, 14 * blink, 14);
      }
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  };
  gsap.ticker.add(tick);

  return () => {
    gsap.ticker.remove(tick);
    removeEventListener('resize', resize);
    document.removeEventListener('intro:done', onIntro);
    document.fonts.removeEventListener('loadingdone', fontsDone);
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    hero.removeEventListener('pointerdown', onDown);
    io.disconnect();
    mo.disconnect();
    [eyeGeo, ringGeo].forEach((g) => g.dispose());
    [ringMat, eyeMat, comp].forEach((mat) => mat.dispose());
    textTex.dispose();
    brandTex.dispose();
    rt.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
