/**
 * WebGL2 renderer: a fullscreen triangle, one program per transition, and
 * two textures (outgoing / incoming) uploaded from ImageBitmaps. All programs
 * compile up front so switching presets never stalls a frame.
 */
import { StudyError } from '../media/errors';
import type { PresetId } from '../config/transitions.config';
import vertexSource from './shaders/fullscreen.vert?raw';
import prelude from './shaders/prelude.glsl?raw';
import passthrough from './shaders/passthrough.frag?raw';
import crossDissolve from './shaders/crossDissolve.frag?raw';
import dipToBlack from './shaders/dipToBlack.frag?raw';
import push from './shaders/push.frag?raw';
import wipe from './shaders/wipe.frag?raw';
import zoom from './shaders/zoom.frag?raw';
import blur from './shaders/blur.frag?raw';

export type ProgramId = PresetId | 'passthrough';

const FRAGMENTS: Record<ProgramId, string> = {
  passthrough,
  crossDissolve,
  dipToBlack,
  push,
  wipe,
  zoom,
  blur,
};

const UNIFORMS = ['uFrom', 'uTo', 'uProgress', 'uLinear', 'uIntensity', 'uParams', 'uResolution'] as const;
type UniformName = (typeof UNIFORMS)[number];

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Record<UniformName, WebGLUniformLocation | null>;
}

export interface TransitionDraw {
  readonly programId: PresetId;
  readonly from: ImageBitmap;
  readonly to: ImageBitmap;
  readonly progress: number;
  readonly linear: number;
  readonly intensity: number;
  readonly params: readonly [number, number, number, number];
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<ProgramId, Program>();
  private vao: WebGLVertexArrayObject | null = null;
  private textures: [WebGLTexture | null, WebGLTexture | null] = [null, null];
  /** Last bitmap uploaded into each texture unit, to skip redundant uploads. */
  private uploaded: [ImageBitmap | null, ImageBitmap | null] = [null, null];
  private lost = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new StudyError('webgl', 'WebGL2 is not available in this browser.', undefined, 'Use a current Chrome, Safari or Firefox with hardware acceleration on.');
    }
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
  }

  get isLost(): boolean {
    return this.lost;
  }

  /** Set the drawing-buffer size. Resizing clears the canvas, so callers redraw right after. */
  resize(width: number, height: number): boolean {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /** Fill the canvas with black, for an empty timeline. */
  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  drawSingle(frame: ImageBitmap): void {
    const p = this.use('passthrough');
    if (!p) return;
    this.bindTexture(0, frame);
    this.gl.uniform1i(p.uniforms.uFrom, 0);
    this.drawQuad(p);
  }

  drawTransition(d: TransitionDraw): void {
    const p = this.use(d.programId);
    if (!p) return;
    const gl = this.gl;
    this.bindTexture(0, d.from);
    this.bindTexture(1, d.to);
    gl.uniform1i(p.uniforms.uFrom, 0);
    gl.uniform1i(p.uniforms.uTo, 1);
    gl.uniform1f(p.uniforms.uProgress, d.progress);
    gl.uniform1f(p.uniforms.uLinear, d.linear);
    gl.uniform1f(p.uniforms.uIntensity, d.intensity);
    gl.uniform4f(p.uniforms.uParams, d.params[0], d.params[1], d.params[2], d.params[3]);
    this.drawQuad(p);
  }

  /** Free GL objects. The context itself is kept so a remount can reuse the canvas. */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.release();
  }

  // -------------------------------------------------------------------------

  private init() {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vertexSource, 'fullscreen.vert');
    for (const [id, body] of Object.entries(FRAGMENTS) as [ProgramId, string][]) {
      const fs = this.compile(gl.FRAGMENT_SHADER, `${prelude}\n${body}`, `${id}.frag`);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
        const log = gl.getProgramInfoLog(program) ?? '';
        throw new StudyError('webgl', `Shader program "${id}" failed to link.`, `${id}.frag`, log);
      }
      gl.deleteShader(fs);
      const uniforms = Object.fromEntries(UNIFORMS.map((u) => [u, gl.getUniformLocation(program, u)])) as Program['uniforms'];
      this.programs.set(id, { program, uniforms });
    }
    gl.deleteShader(vs);

    this.vao = gl.createVertexArray();
    for (const unit of [0, 1] as const) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures[unit] = tex;
    }
    this.uploaded = [null, null];
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  private compile(type: number, source: string, name: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new StudyError('webgl', 'Could not create a shader.', name);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(shader) ?? '';
      throw new StudyError('webgl', `Shader "${name}" failed to compile.`, name, log);
    }
    return shader;
  }

  private release() {
    const gl = this.gl;
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    this.programs.clear();
    for (const t of this.textures) if (t) gl.deleteTexture(t);
    this.textures = [null, null];
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = null;
    this.uploaded = [null, null];
  }

  private use(id: ProgramId): Program | null {
    if (this.lost) return null;
    const p = this.programs.get(id);
    if (!p) return null;
    this.gl.useProgram(p.program);
    return p;
  }

  private bindTexture(unit: 0 | 1, bitmap: ImageBitmap) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
    if (this.uploaded[unit] !== bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      this.uploaded[unit] = bitmap;
    }
  }

  private drawQuad(p: Program) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(p.uniforms.uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.lost = false;
    this.programs.clear();
    this.init();
    this.onRestore?.();
  };

  /** Called after a lost context is restored, so the owner can redraw. */
  onRestore: (() => void) | null = null;
}
