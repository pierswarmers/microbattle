// Tiny instanced WebGL2 renderer: flat-shaded vertex-coloured meshes, sun + hemisphere light,
// PCF shadow map, cloud shadows, fog, sky dome and alpha-blended effects.
import { m4 } from './math.js';

const FLOATS_PER_INSTANCE = 20; // mat4 + rgba

const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 iM0;
layout(location=4) in vec4 iM1;
layout(location=5) in vec4 iM2;
layout(location=6) in vec4 iM3;
layout(location=7) in vec4 iCol;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uSway;
uniform int uMode;
out vec3 vNor;
out vec4 vCol;
out vec3 vWorld;
out vec4 vLight;
void main() {
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 wp = M * vec4(aPos, 1.0);
  if (uSway > 0.0) {
    float h = max(aPos.y, 0.0);
    float k = uSway * h * h;
    wp.x += sin(uTime * 1.9 + wp.x * 0.13 + wp.z * 0.07) * k;
    wp.z += cos(uTime * 1.4 + wp.x * 0.05 + wp.z * 0.11) * k * 0.6;
  }
  vec3 n = mat3(M) * aNor;
  if (uMode == 2) {
    float w = sin(wp.x * 0.35 + uTime * 1.6) * 0.08 + cos(wp.z * 0.3 + uTime * 1.2) * 0.08;
    wp.y += w;
    n = normalize(vec3(-cos(wp.x * 0.35 + uTime * 1.6) * 0.1, 1.0, sin(wp.z * 0.3 + uTime * 1.2) * 0.1));
  }
  vNor = n;
  vec3 base = aCol.rgb;
  vCol = vec4(mix(base, base * iCol.rgb, aCol.a), iCol.a);
  vWorld = wp.xyz;
  vLight = uLightVP * wp;
  gl_Position = uVP * wp;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
in vec3 vNor;
in vec4 vCol;
in vec3 vWorld;
in vec4 vLight;
uniform sampler2DShadow uShadow;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uFogCol;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform float uTime;
uniform int uMode;
uniform float uShadowOn;
out vec4 outCol;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float shadowAt(float ndl) {
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  // slope-scaled bias avoids striping on steep hillsides
  float bias = 0.0014 + 0.005 * (1.0 - ndl);
  vec2 t = vec2(1.0 / 2048.0);
  float s = 0.0;
  s += texture(uShadow, vec3(p.xy + vec2(-t.x, -t.y), p.z - bias));
  s += texture(uShadow, vec3(p.xy + vec2(t.x, -t.y), p.z - bias));
  s += texture(uShadow, vec3(p.xy + vec2(-t.x, t.y), p.z - bias));
  s += texture(uShadow, vec3(p.xy + vec2(t.x, t.y), p.z - bias));
  return s * 0.25;
}

void main() {
  if (uMode == 1) { // unlit / emissive
    outCol = vCol;
    return;
  }
  if (uMode == 3) { // toon fire: self-lit but still shaded so fireballs read as round puffs
    vec3 nn = normalize(vNor);
    float l = max(dot(nn, uSunDir), 0.0);
    vec3 vv = normalize(uCamPos - vWorld);
    float rim = pow(1.0 - max(dot(nn, vv), 0.0), 2.0);
    outCol = vec4(vCol.rgb * (0.62 + 0.5 * smoothstep(0.0, 0.7, l)) + vec3(0.25, 0.12, 0.0) * rim, vCol.a);
    return;
  }
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  float ndl = max(dot(n, uSunDir), 0.0);
  float rawNdl = ndl;
  // soft cel banding for a toy-like look
  ndl = smoothstep(0.0, 0.08, ndl) * 0.35 + smoothstep(0.25, 0.6, ndl) * 0.45 + ndl * 0.2;
  float sh = uShadowOn > 0.5 ? shadowAt(rawNdl) : 1.0;
  // fade real shadows out with distance (the shadow map only covers the area near the action)
  sh = mix(sh, 1.0, smoothstep(140.0, 220.0, length(uCamPos - vWorld)));
  float cloud = smoothstep(0.52, 0.72, vnoise(vWorld.xz * 0.012 + vec2(uTime * 0.018, uTime * 0.007)));
  sh *= 1.0 - cloud * 0.32;
  vec3 hemi = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 col = vCol.rgb * (hemi * 0.55 + uSunCol * ndl * sh * 0.85);
  // rim light keeps silhouettes readable
  vec3 v = normalize(uCamPos - vWorld);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vCol.rgb * rim * 0.18;
  float alpha = vCol.a;
  // smoke right in front of the camera fades out instead of filling the gunner's sight
  if (alpha < 0.999) alpha *= smoothstep(1.5, 7.0, length(uCamPos - vWorld));
  if (uMode == 2) {
    vec3 h = normalize(uSunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 60.0);
    float sparkle = step(0.93, vnoise(vWorld.xz * 1.3 + uTime * 0.8));
    col += uSunCol * (spec * 0.8 + sparkle * 0.25 * sh);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    col = mix(col, uSkyCol * 1.1, fres * 0.4);
  }
  float d = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-pow(d * uFogDensity, 1.6));
  col = mix(col, uFogCol, clamp(fog, 0.0, 1.0));
  outCol = vec4(col, alpha);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 iM0;
layout(location=4) in vec4 iM1;
layout(location=5) in vec4 iM2;
layout(location=6) in vec4 iM3;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uSway;
void main() {
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 wp = M * vec4(aPos, 1.0);
  if (uSway > 0.0) {
    float h = max(aPos.y, 0.0);
    float k = uSway * h * h;
    wp.x += sin(uTime * 1.9 + wp.x * 0.13 + wp.z * 0.07) * k;
    wp.z += cos(uTime * 1.4 + wp.x * 0.05 + wp.z * 0.11) * k * 0.6;
  }
  gl_Position = uLightVP * wp;
}`;
const SHADOW_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }`;

const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vUv = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInvVP;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
out vec4 o;
void main() {
  vec4 a = uInvVP * vec4(vUv, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vUv, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.55));
  if (dir.y < 0.0) col = mix(uHorizon, uHorizon * 0.85, clamp(-dir.y * 4.0, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.85, 0.5) * pow(sd, 18.0) * 0.45;
  col += vec3(1.0, 0.95, 0.7) * pow(sd, 200.0) * 0.8;
  col = mix(col, vec3(1.0, 0.98, 0.85), smoothstep(0.9965, 0.9975, sd));
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/**
 * A mesh with an instance buffer. Call `add(matrix, r, g, b, a)` each frame for dynamic meshes;
 * static meshes keep their instances until `clear()`.
 */
export class Mesh {
  constructor(r, geo, opts = {}) {
    const gl = r.gl;
    this.r = r;
    this.count = geo.pos.length / 3;
    this.static = !!opts.static;
    this.sway = opts.sway || 0;
    this.mode = opts.mode || 0; // 0 lit, 1 unlit, 2 water
    this.castShadow = opts.castShadow !== false;
    this.transparent = !!opts.transparent;
    this.additive = !!opts.additive;
    this.cull = opts.cull !== false;
    this.layer = opts.layer || 0;
    this.cap = opts.capacity || 64;
    this.data = new Float32Array(this.cap * FLOATS_PER_INSTANCE);
    this.n = 0;
    this.dirty = true;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    const inter = new Float32Array(this.count * 10);
    for (let i = 0; i < this.count; i++) {
      inter.set(geo.pos.slice(i * 3, i * 3 + 3), i * 10);
      inter.set(geo.nor.slice(i * 3, i * 3 + 3), i * 10 + 3);
      inter.set(geo.col.slice(i * 4, i * 4 + 4), i * 10 + 6);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    this.ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.bindInstanceAttribs();
    gl.bindVertexArray(null);
    r.meshes.push(this);
    r.meshes.sort((a, b) => a.layer - b.layer);
  }

  bindInstanceAttribs() {
    const gl = this.r.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(3 + i);
      gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, i * 16);
      gl.vertexAttribDivisor(3 + i, 1);
    }
  }

  grow() {
    const gl = this.r.gl;
    this.cap *= 2;
    const d = new Float32Array(this.cap * FLOATS_PER_INSTANCE);
    d.set(this.data);
    this.data = d;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.bindInstanceAttribs();
    gl.bindVertexArray(null);
  }

  add(m, r = 1, g = 1, b = 1, a = 1) {
    if (this.n >= this.cap) this.grow();
    const o = this.n * FLOATS_PER_INSTANCE;
    const d = this.data;
    for (let i = 0; i < 16; i++) d[o + i] = m[i];
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b; d[o + 19] = a;
    this.n++;
    this.dirty = true;
  }

  clear() { this.n = 0; this.dirty = true; }

  upload() {
    if (!this.dirty) return;
    const gl = this.r.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * FLOATS_PER_INSTANCE);
    this.dirty = false;
  }
}

export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: opts.antialias !== false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.meshes = [];
    this.main = program(gl, MAIN_VS, MAIN_FS);
    this.shadowProg = program(gl, SHADOW_VS, SHADOW_FS);
    this.sky = program(gl, SKY_VS, SKY_FS);
    this.skyVao = gl.createVertexArray();
    this.shadowSize = opts.shadowSize || 2048;
    this.shadowsOn = opts.shadows !== false;
    this.initShadow();
    this.vp = m4.create();
    this.lightVP = m4.create();
    this.tmp = m4.create();
    this.tmp2 = m4.create();
    this.invVP = m4.create();
    this.time = 0;
    this.env = {
      sunDir: normalize([0.45, 0.8, 0.35]),
      sunCol: [1.0, 0.96, 0.86],
      sky: [0.62, 0.8, 1.0],
      ground: [0.5, 0.55, 0.32],
      fog: [0.72, 0.85, 0.98],
      zenith: [0.32, 0.58, 0.95],
      horizon: [0.78, 0.9, 1.0],
      fogDensity: 0.0032,
    };
    gl.enable(gl.DEPTH_TEST);
  }

  initShadow() {
    const gl = this.gl;
    const s = this.shadowSize;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, s, s);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(dpr) {
    const c = this.canvas;
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  /** Begin a frame: upload dirty instance buffers once, shared by all viewports. */
  beginFrame(time) {
    this.time = time;
    for (const m of this.meshes) m.upload();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Render one viewport. vp = {x,y,w,h (css px, top-left origin), view, proj, cam:[x,y,z],
   * shadowCenter:[x,y,z], shadowRadius, sky:boolean}
   */
  renderView(v) {
    const gl = this.gl;
    const env = this.env;
    m4.multiply(this.vp, v.proj, v.view);

    // --- shadow pass ---
    const doShadow = this.shadowsOn;
    if (doShadow) {
      const c = v.shadowCenter, R = v.shadowRadius;
      const sd = env.sunDir;
      const lv = this.tmp, lp = this.tmp2;
      m4.lookAt(lv, c[0] + sd[0] * 200, c[1] + sd[1] * 200, c[2] + sd[2] * 200, c[0], c[1], c[2]);
      // snap to texels to reduce shimmering
      const texel = (2 * R) / this.shadowSize;
      lv[12] = Math.round(lv[12] / texel) * texel;
      lv[13] = Math.round(lv[13] / texel) * texel;
      m4.ortho(lp, -R, R, -R, R, 20, 420);
      m4.multiply(this.lightVP, lp, lv);
      // unbind the shadow texture first: sampling it while it is the render target is a feedback loop
      // (that silently dropped the shadow pass for every view after the first in split-screen)
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2, 4);
      const sp = this.shadowProg;
      gl.useProgram(sp.p);
      gl.uniformMatrix4fv(sp.u.uLightVP, false, this.lightVP);
      gl.uniform1f(sp.u.uTime, this.time);
      for (const m of this.meshes) {
        if (!m.castShadow || m.transparent || m.n === 0 || m.mode !== 0) continue;
        gl.uniform1f(sp.u.uSway, m.sway);
        gl.bindVertexArray(m.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // --- main pass ---
    const dpr = this.canvas.width / this.canvas.clientWidth;
    const H = this.canvas.height;
    const vx = Math.round(v.x * dpr), vy = Math.round(H - (v.y + v.h) * dpr);
    const vw = Math.round(v.w * dpr), vh = Math.round(v.h * dpr);
    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);
    gl.clearColor(env.horizon[0], env.horizon[1], env.horizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);

    // sky
    if (v.sky !== false) {
      m4.invert(this.invVP, this.vp);
      gl.useProgram(this.sky.p);
      gl.uniformMatrix4fv(this.sky.u.uInvVP, false, this.invVP);
      gl.uniform3fv(this.sky.u.uSunDir, env.sunDir);
      gl.uniform3fv(this.sky.u.uZenith, env.zenith);
      gl.uniform3fv(this.sky.u.uHorizon, env.horizon);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }

    const P = this.main;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniformMatrix4fv(P.u.uLightVP, false, this.lightVP);
    gl.uniform1f(P.u.uTime, this.time);
    gl.uniform3fv(P.u.uSunDir, env.sunDir);
    gl.uniform3fv(P.u.uSunCol, env.sunCol);
    gl.uniform3fv(P.u.uSkyCol, env.sky);
    gl.uniform3fv(P.u.uGroundCol, env.ground);
    gl.uniform3fv(P.u.uFogCol, env.fog);
    gl.uniform1f(P.u.uFogDensity, v.fogDensity ?? env.fogDensity);
    gl.uniform3fv(P.u.uCamPos, v.cam);
    gl.uniform1f(P.u.uShadowOn, doShadow ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(P.u.uShadow, 0);

    // opaque
    gl.disable(gl.BLEND);
    for (const m of this.meshes) {
      if (m.transparent || m.n === 0) continue;
      this.drawMesh(m);
    }
    // transparent
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    for (const m of this.meshes) {
      if (!m.transparent || m.n === 0) continue;
      if (m.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawMesh(m);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  drawMesh(m) {
    const gl = this.gl, P = this.main;
    if (m.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    gl.uniform1f(P.u.uSway, m.sway);
    gl.uniform1i(P.u.uMode, m.mode);
    gl.bindVertexArray(m.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n);
  }
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
