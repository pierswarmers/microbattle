// Tiny instanced WebGL2 renderer for a toy-diorama cartoon look: vertex-coloured meshes with cel-banded
// sun + hemisphere light, warm rim, inverted-hull outlines, blob contact shadows, faint cloud shadows,
// linear fog, gradient sky and alpha-blended effects. No textures and no shadow maps.
import { m4 } from './math.js';

const FLOATS_PER_INSTANCE = 20; // mat4 + rgba
const MAX_CLOUDS = 16;

const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 iM0;
layout(location=4) in vec4 iM1;
layout(location=5) in vec4 iM2;
layout(location=6) in vec4 iM3;
layout(location=7) in vec4 iCol;
layout(location=8) in vec3 aOut;
uniform mat4 uVP;
uniform float uTime;
uniform float uSway;
uniform int uMode;
uniform vec3 uCamPos;
uniform vec3 uFocus;
uniform float uOutline;
uniform float uOutlineMax;
out vec3 vNor;
out vec4 vCol;
out vec3 vWorld;
out vec4 vVert;
out float vFade;
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
  if (uOutline > 0.0) {
    // inverted hull: push the back faces out along the smoothed normal, roughly constant on screen
    vec3 on = normalize(mat3(M) * aOut);
    wp.xyz += on * min(length(uCamPos - wp.xyz) * uOutline, uOutlineMax);
  }
  if (uMode == 2) n = vec3(0.0, 1.0, 0.0);
  vNor = n;
  vec3 base = aCol.rgb;
  vCol = vec4(mix(base, base * iCol.rgb, aCol.a), iCol.a);
  vVert = aCol;
  vFade = 1.0;
  if (uMode == 6) {
    // clouds go see-through when they sit between the camera and what it is looking at
    vec3 c = iM3.xyz;
    vec3 ab = uFocus - uCamPos;
    float t = clamp(dot(c - uCamPos, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float dl = length(c - (uCamPos + ab * t));
    float rad = length(iM0.xyz) * 10.0;
    vFade = mix(0.1, 1.0, smoothstep(rad * 0.7, rad * 1.6, dl));
    vFade *= mix(0.1, 1.0, smoothstep(rad * 1.2, rad * 3.0, length(c - uCamPos)));
  }
  vWorld = wp.xyz;
  gl_Position = uVP * wp;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vNor;
in vec4 vCol;
in vec3 vWorld;
in vec4 vVert;
in float vFade;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uRimCol;
uniform vec3 uFogCol;
uniform vec2 uFog;
uniform vec3 uCamPos;
uniform float uTime;
uniform int uMode;
uniform float uOutline;
uniform vec4 uClouds[${MAX_CLOUDS}];
uniform int uCloudN;
out vec4 outCol;

float fogAt(float d) {
  float k = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0) * 0.85;
  return k + clamp((d - uFog.y) / (uFog.y - uFog.x), 0.0, 1.0) * 0.15;
}

// very faint soft shadows cast by the drifting clouds, projected along the sun
float cloudShade(vec3 p) {
  float s = 0.0;
  vec2 lean = uSunDir.xz / uSunDir.y;
  for (int i = 0; i < ${MAX_CLOUDS}; i++) {
    if (i >= uCloudN) break;
    vec4 c = uClouds[i];
    vec2 g = c.xy - lean * (c.w - p.y);
    s += 1.0 - smoothstep(c.z * 0.35, c.z, length(p.xz - g));
  }
  return 1.0 - 0.05 * min(s, 1.0);
}

void main() {
  float d = length(uCamPos - vWorld);
  float fog = fogAt(d);
  if (uOutline > 0.0) {
    // cartoon ink: a dark plum-tinted take on the object's own colour
    vec3 ink = vCol.rgb * 0.2 + vec3(0.14, 0.05, 0.13);
    // see-through props keep a firmer ink line than their body so the silhouette still reads
    outCol = vec4(mix(ink, uFogCol, fog), min(vCol.a * 2.0, 1.0));
    return;
  }
  if (uMode == 1) { // unlit / emissive; translucent ones fade out right in front of the camera
    float a1 = vCol.a;
    if (a1 < 0.999) a1 *= smoothstep(3.0, 18.0, d);
    outCol = vec4(vCol.rgb, a1);
    return;
  }
  if (uMode == 5) { // soft blob (contact shadow / scorch): instance colour, vertex red channel is the falloff
    outCol = vec4(vCol.rgb, vCol.a * vVert.r * (1.0 - fog));
    return;
  }
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing && uMode != 7) n = -n; // mode 7: two-sided cards lit like the ground
  vec3 v = normalize(uCamPos - vWorld);
  float ndl = dot(n, uSunDir);
  if (uMode == 3) { // toon fire: self-lit, bright core fading to a warm rim so fireballs read as round puffs
    float facing = max(dot(n, v), 0.0);
    vec3 c = vCol.rgb * (0.75 + 0.35 * smoothstep(0.0, 0.7, max(ndl, 0.0)));
    c = mix(c * 0.8, c * 1.25 + vec3(0.08, 0.06, 0.0), smoothstep(0.2, 0.9, facing));
    outCol = vec4(c, vCol.a * smoothstep(0.0, 0.25, facing));
    return;
  }
  if (uMode == 4) { // soft cartoon smoke / poofs: no hard lighting facets, edges fade out
    float facing = max(dot(n, v), 0.0);
    vec3 c = vCol.rgb * (0.86 + 0.14 * (n.y * 0.5 + 0.5)) + uSunCol * 0.04;
    float a = vCol.a * smoothstep(0.0, 0.55, facing) * smoothstep(1.5, 7.0, d);
    outCol = vec4(mix(c, uFogCol, fog), a);
    return;
  }
  if (uMode == 2) { // flat toy water with a slow shimmer
    float sh = sin(vWorld.x * 0.55 + uTime * 0.8) * sin(vWorld.z * 0.47 - uTime * 0.6);
    float sparkle = smoothstep(0.82, 0.95, sh * 0.5 + 0.5 * sin(vWorld.x * 1.3 - vWorld.z * 0.9 + uTime * 1.3));
    vec3 col = vCol.rgb * (0.92 + 0.08 * sh) + vec3(0.9, 0.97, 1.0) * sparkle * 0.18;
    col *= cloudShade(vWorld);
    outCol = vec4(mix(col, uFogCol, fog), vCol.a);
    return;
  }
  if (uMode == 6) { // cloud puffs: soft two-tone, slightly translucent
    float lit = 0.84 + 0.1 * smoothstep(-0.05, 0.05, ndl) + 0.06 * smoothstep(0.43, 0.47, ndl);
    vec3 col = mix(vec3(0.86, 0.9, 0.98), vec3(1.0), smoothstep(-0.3, 0.5, n.y)) * lit;
    col += uRimCol * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.16;
    outCol = vec4(mix(col, uFogCol, fog * 0.5), vCol.a * vFade);
    return;
  }
  // cel lighting: crisp terminator, a brighter band above ~45% facing, plus a little smooth Lambert
  float diff = 0.5 * smoothstep(0.0, 0.03, ndl) + 0.3 * smoothstep(0.43, 0.47, ndl) + 0.2 * max(ndl, 0.0);
  vec3 hemi = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 col = vCol.rgb * (hemi * 0.85 + uSunCol * diff * 0.58);
  col *= cloudShade(vWorld);
  col += uRimCol * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.16;
  float alpha = vCol.a;
  // smoke right in front of the camera fades out instead of filling the gunner's sight
  if (alpha < 0.999) alpha *= smoothstep(1.5, 7.0, d);
  outCol = vec4(mix(col, uFogCol, fog), alpha);
}`;

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
uniform vec3 uMid;
uniform vec3 uHorizon;
out vec4 o;
void main() {
  vec4 a = uInvVP * vec4(vUv, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vUv, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
  col = mix(col, uZenith, smoothstep(0.22, 0.75, t));
  if (dir.y < 0.0) col = mix(uHorizon, uMid, clamp(-dir.y * 1.5, 0.0, 0.6));
  // soft glowing sun disc
  float sd = max(dot(dir, uSunDir), 0.0);
  col = mix(col, vec3(1.0, 0.878, 0.4), pow(sd, 90.0) * 0.45);
  col = mix(col, vec3(1.0, 0.878, 0.4), smoothstep(0.9960, 0.9975, sd));
  col = mix(col, vec3(1.0, 0.965, 0.69), smoothstep(0.9978, 0.9988, sd));
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
    this.mode = opts.mode || 0; // 0 lit, 1 unlit, 2 water, 3 fire, 4 soft smoke, 5 soft blob, 6 cloud, 7 lit two-sided
    // ghost: see-through prop that keeps its outline and only shows its front-most surface
    this.ghost = !!opts.ghost;
    this.transparent = !!opts.transparent || this.ghost;
    this.additive = !!opts.additive;
    this.cull = opts.cull !== false;
    this.layer = opts.layer || 0;
    this.ground = !!opts.ground; // ground decal: pulled towards the camera so it never z-fights the terrain
    this.xray = !!opts.xray; // drawn only where something is in front of it
    // every solid lit prop gets a cartoon outline unless it opts out
    this.outline = opts.outline ?? (this.mode === 0 && (!this.transparent || this.ghost) && this.cull);
    this.outlineMax = opts.outlineMax || 0.16;
    this.cap = opts.capacity || 64;
    this.data = new Float32Array(this.cap * FLOATS_PER_INSTANCE);
    this.n = 0;
    this.dirty = true;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    const out = this.outline ? outlineNormals(geo.pos, geo.nor) : geo.nor;
    const inter = new Float32Array(this.count * 13);
    for (let i = 0; i < this.count; i++) {
      const o = i * 13;
      for (let k = 0; k < 3; k++) { inter[o + k] = geo.pos[i * 3 + k]; inter[o + 3 + k] = geo.nor[i * 3 + k]; inter[o + 10 + k] = out[i * 3 + k]; }
      for (let k = 0; k < 4; k++) inter[o + 6 + k] = geo.col[i * 4 + k];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 52, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 52, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 52, 24);
    gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 3, gl.FLOAT, false, 52, 40);
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

/** Per-vertex normals averaged over every face sharing the position, so an inflated hull has no cracks. */
function outlineNormals(pos, nor) {
  const acc = new Map();
  const key = (i) => `${Math.round(pos[i] * 1e3)},${Math.round(pos[i + 1] * 1e3)},${Math.round(pos[i + 2] * 1e3)}`;
  for (let i = 0; i < pos.length; i += 3) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += nor[i]; a[1] += nor[i + 1]; a[2] += nor[i + 2];
  }
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < 1e-3) { out[i] = nor[i]; out[i + 1] = nor[i + 1]; out[i + 2] = nor[i + 2]; }
    else { out[i] = a[0] / l; out[i + 1] = a[1] / l; out[i + 2] = a[2] / l; }
  }
  return out;
}

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export { hex };

export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: opts.antialias !== false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.meshes = [];
    this.main = program(gl, MAIN_VS, MAIN_FS);
    this.sky = program(gl, SKY_VS, SKY_FS);
    this.skyVao = gl.createVertexArray();
    this.vp = m4.create();
    this.invVP = m4.create();
    this.time = 0;
    this.clouds = new Float32Array(MAX_CLOUDS * 4);
    this.cloudN = 0;
    this.env = {
      sunDir: normalize([0.45, 0.85, 0.32]),
      sunCol: [1.0, 0.95, 0.84],
      sky: hex('#8F99B3'),
      ground: hex('#665C4D'),
      rim: [1.0, 0.93, 0.78],
      fog: hex('#C7E0F5'),
      zenith: hex('#7CC6FF'),
      mid: hex('#A8DCFF'),
      horizon: hex('#D9F1FF'),
      fogNear: 60,
      fogFar: 160,
    };
    // outline thickness: world units per unit of camera distance (about 3-4 px at 1080p), capped per mesh
    this.outlineK = 0.0026;
    gl.enable(gl.DEPTH_TEST);
  }

  /** Cloud shadow casters: [{x, z, r, y}] */
  setClouds(list) {
    const n = Math.min(list.length, MAX_CLOUDS);
    for (let i = 0; i < n; i++) { const c = list[i]; this.clouds.set([c.x, c.z, c.r, c.y], i * 4); }
    this.cloudN = n;
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
   * focus:[x,y,z], fogNear, fogFar, sky:boolean}
   */
  renderView(v) {
    const gl = this.gl;
    const env = this.env;
    m4.multiply(this.vp, v.proj, v.view);

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
      gl.uniform3fv(this.sky.u.uMid, env.mid);
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
    gl.uniform1f(P.u.uTime, this.time);
    gl.uniform3fv(P.u.uSunDir, env.sunDir);
    gl.uniform3fv(P.u.uSunCol, env.sunCol);
    gl.uniform3fv(P.u.uSkyCol, env.sky);
    gl.uniform3fv(P.u.uGroundCol, env.ground);
    gl.uniform3fv(P.u.uRimCol, env.rim);
    gl.uniform3fv(P.u.uFogCol, env.fog);
    gl.uniform2f(P.u.uFog, v.fogNear ?? env.fogNear, v.fogFar ?? env.fogFar);
    gl.uniform3fv(P.u.uCamPos, v.cam);
    gl.uniform3fv(P.u.uFocus, v.focus || v.cam);
    gl.uniform4fv(P.u['uClouds[0]'], this.clouds);
    gl.uniform1i(P.u.uCloudN, this.cloudN);
    gl.uniform1f(P.u.uOutline, 0);

    // opaque
    gl.disable(gl.BLEND);
    for (const m of this.meshes) {
      if (m.transparent || m.n === 0) continue;
      this.drawMesh(m);
    }
    // cartoon outlines: inflated back faces drawn behind the solid pass
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.uniform1f(P.u.uOutline, this.outlineK);
    for (const m of this.meshes) {
      if (!m.outline || m.transparent || m.n === 0) continue;
      gl.uniform1f(P.u.uSway, m.sway);
      gl.uniform1i(P.u.uMode, m.mode);
      gl.uniform1f(P.u.uOutlineMax, m.outlineMax);
      gl.bindVertexArray(m.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n);
    }
    gl.cullFace(gl.BACK);
    gl.uniform1f(P.u.uOutline, 0);
    // transparent
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    for (const m of this.meshes) {
      if (!m.transparent || m.n === 0) continue;
      if (m.ghost) { this.drawGhost(m); continue; }
      if (m.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (m.mode === 5 || m.ground) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4); }
      if (m.xray) gl.depthFunc(gl.GREATER);
      this.drawMesh(m);
      if (m.xray) gl.depthFunc(gl.LESS);
      if (m.mode === 5 || m.ground) gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * See-through prop: lay down depth for the body and its outline hull first, then blend only the
   * front-most surfaces, so overlapping facets inside a canopy never double up and the ink stays crisp.
   */
  drawGhost(m) {
    const gl = this.gl;
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    this.drawMesh(m);
    this.drawOutline(m);
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawOutline(m);
    this.drawMesh(m);
    gl.depthFunc(gl.LESS);
  }

  drawOutline(m) {
    const gl = this.gl, P = this.main;
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.uniform1f(P.u.uOutline, this.outlineK);
    gl.uniform1f(P.u.uOutlineMax, m.outlineMax);
    gl.uniform1f(P.u.uSway, m.sway);
    gl.uniform1i(P.u.uMode, m.mode);
    gl.bindVertexArray(m.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n);
    gl.cullFace(gl.BACK);
    gl.uniform1f(P.u.uOutline, 0);
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
