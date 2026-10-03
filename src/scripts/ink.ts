/**
 * Shared WebGL2 metaball renderer for the ink effects (hero splats and page
 * transitions). It draws only where the ink field is ≥ 1; everywhere else the
 * canvas stays transparent so the DOM shows through. Inside the ink, an
 * optional text mask and the analytic logo mark are drawn in the paper colour,
 * so whatever the ink covers appears inverted — still only two colours.
 */

export const MAX_BLOBS = 128;

export type RGB = [number, number, number];
export interface Circle {
  x: number;
  y: number;
  r: number;
}
export interface MarkPose {
  /** Centre and size of one SVG user unit, in CSS px relative to the canvas. */
  x: number;
  y: number;
  unit: number;
  /** Eye offset (user units) and vertical scale (blink). */
  ex: number;
  ey: number;
  sy: number;
}
export interface InkFrame {
  blobs: Circle[];
  ink: RGB;
  paper?: RGB;
  /** Added to the field everywhere; ≥ 1 floods the whole canvas. */
  cover?: number;
  mark?: MarkPose | null;
}

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
#define MAX ${MAX_BLOBS}
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uBlobs[MAX];
uniform int uCount;
uniform float uCover;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform sampler2D uText;
uniform float uHasText;
uniform vec4 uMark;
uniform vec3 uEye;
out vec4 o;

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  // Compact kernel (support 2r, value 1 at d = r): nearby drops fuse with a
  // neck, distant ones stay separate — which is what makes a splat read.
  float f = uCover;
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
  if (ink <= 0.0) { o = vec4(0.0); return; }

  float t = 0.0;
  if (uHasText > 0.5) t = texture(uText, p / uRes).a;
  if (uMark.w > 0.5) {
    // Same geometry as Mark.astro: ring r=34, stroke 16, 70° mouth, eye r=9.
    vec2 q = (p - uMark.xy) / uMark.z;
    float len = length(q);
    float ring = abs(len - 34.0) - 8.0;
    ring = max(ring, (0.6109 - abs(atan(q.y, q.x))) * len);
    vec2 e = q - uEye.xy;
    e.y /= max(uEye.z, 0.05);
    float eye = (length(e) - 9.0) * min(uEye.z, 1.0);
    float md = min(ring, eye) * uMark.z;
    t = max(t, 1.0 - smoothstep(-0.75, 0.75, md));
  }
  o = vec4(mix(uInk, uPaper, t), 1.0) * ink;
}`;

/** Read a colour custom property (e.g. --fg) as 0–1 RGB. */
export function cssColor(el: Element, prop: string): RGB {
  const v = getComputedStyle(el).getPropertyValue(prop).trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const parts = v.match(/[\d.]+/g);
  return parts ? [+parts[0] / 255, +parts[1] / 255, +parts[2] / 255] : [0, 0, 0];
}

const UNIFORMS = ['uRes', 'uDpr', 'uBlobs', 'uCount', 'uCover', 'uInk', 'uPaper', 'uText', 'uHasText', 'uMark', 'uEye'] as const;

export class Ink {
  readonly dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private data = new Float32Array(MAX_BLOBS * 4);
  private tex: WebGLTexture | null = null;
  private hasText = false;
  private w = 1;
  private h = 1;

  static create(canvas: HTMLCanvasElement): Ink | null {
    try {
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
      return gl ? new Ink(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    private gl: WebGL2RenderingContext,
  ) {
    const prog = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);

    // One oversized triangle covers the viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
    gl.uniform1i(this.u.uText, 0);
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Alpha of `src` marks the shapes drawn in paper colour inside the ink. */
  setText(src: TexImageSource | null) {
    const gl = this.gl;
    this.hasText = !!src;
    if (!src) return;
    if (!this.tex) {
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  draw(f: InkFrame) {
    const { gl, u, data } = this;
    const n = Math.min(f.blobs.length, MAX_BLOBS);
    for (let i = 0; i < n; i++) {
      const b = f.blobs[i];
      data[i * 4] = b.x;
      data[i * 4 + 1] = b.y;
      data[i * 4 + 2] = b.r;
    }
    gl.uniform2f(u.uRes, this.w, this.h);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform4fv(u.uBlobs, data);
    gl.uniform1i(u.uCount, n);
    gl.uniform1f(u.uCover, f.cover ?? 0);
    gl.uniform3fv(u.uInk, f.ink);
    gl.uniform3fv(u.uPaper, f.paper ?? f.ink);
    gl.uniform1f(u.uHasText, this.hasText ? 1 : 0);
    const m = f.mark;
    gl.uniform4f(u.uMark, m?.x ?? 0, m?.y ?? 0, m?.unit ?? 1, m ? 1 : 0);
    gl.uniform3f(u.uEye, m?.ex ?? 0, m?.ey ?? 0, m?.sy ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  clear() {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
