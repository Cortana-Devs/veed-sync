import ShaderUtils from "../shaders/shaderUtils";

// Minimal OBJ parser for v lines only (point cloud). Optimized for large files.
function parseOBJToPoints(text, sampleEvery = 1) {
  const pts = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.length < 2) continue;
    if ((i % sampleEvery) === 0 && line[0] === 'v' && (line[1] === ' ' || line[1] === '\t')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          pts.push(x, y, z);
        }
      }
    }
    i++;
  }
  return new Float32Array(pts);
}

export default class ParticleModel {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.enabled = false;
    this.pointSize = opts.pointSize || 2.0;
    this.color = opts.color || [0.9, 0.95, 1.0, 0.85];
    this.scale = opts.scale || 0.5;
    this.spin = 0;
    this.spinSpeed = 0.2;

    // Simple camera config (overridable via setCamera)
    this.camera = {
      fov: 50 * Math.PI / 180,
      aspect: 16 / 9,
      near: 0.1,
      far: 50.0,
      eye: [0, 0.6, 3.0],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fogNear: 6.0,
      fogFar: 18.0,
      lightDir: [0.4, 0.7, 0.5],
    };

    this.floatPrecision = ShaderUtils.getFragmentFloatPrecision(this.gl);
    this.createShader();
    this.posBuf = this.gl.createBuffer();
    this.count = 0;

    // Arcane-style palette defaults
    this.keyColor = opts.keyColor || [1.0, 0.86, 0.66];
    this.rimColor = opts.rimColor || [0.55, 0.75, 1.0];
    this.fogColor = opts.fogColor || [0.12, 0.10, 0.22];
  }

  setEnabled(v) { this.enabled = !!v; }
  configure(cfg = {}) {
    if (typeof cfg.pointSize === 'number') this.pointSize = cfg.pointSize;
    if (Array.isArray(cfg.color)) this.color = cfg.color;
    if (typeof cfg.scale === 'number') this.scale = cfg.scale;
    if (typeof cfg.spinSpeed === 'number') this.spinSpeed = cfg.spinSpeed;
  }

  setCamera(camera = {}) {
    this.camera = Object.assign({}, this.camera, camera);
  }

  // Minimal mat4 helpers
  static _normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l];
  }
  static _cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  static _sub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  static _lookAt(eye, target, up) {
    const z = ParticleModel._normalize(ParticleModel._sub(eye, target));
    const x = ParticleModel._normalize(ParticleModel._cross(up, z));
    const y = ParticleModel._cross(z, x);
    // Column-major
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0]*eye[0] + x[1]*eye[1] + x[2]*eye[2]),
      -(y[0]*eye[0] + y[1]*eye[1] + y[2]*eye[2]),
      -(z[0]*eye[0] + z[1]*eye[1] + z[2]*eye[2]),
      1,
    ]);
  }
  static _perspective(fov, aspect, near, far) {
    const f = 1.0 / Math.tan(fov/2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f/aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far+near)*nf, -1,
      0, 0, (2*far*near)*nf, 0,
    ]);
  }

  createShader() {
    const vs = this.gl.createShader(this.gl.VERTEX_SHADER);
    this.gl.shaderSource(vs, `
      #version 300 es
      in vec3 aPos;
      uniform float u_pointSize;
      uniform float u_scale;
      uniform float u_spin;
      uniform mat4 u_view;
      uniform mat4 u_proj;
      uniform vec3 u_lightDir;
      out float vDepth;
      out float vLight;
      out float vRim;
      void main(){
        // spin around Y, scale
        float c = cos(u_spin), s = sin(u_spin);
        vec3 p = vec3( aPos.x*c + aPos.z*s, aPos.y, -aPos.x*s + aPos.z*c );
        vec3 q = p * u_scale;
        vec4 viewPos = u_view * vec4(q, 1.0);
        vDepth = -viewPos.z;
        // approximate normal with centered position
        vec3 n = normalize(q);
        vLight = clamp(dot(normalize(u_lightDir), n) * 0.5 + 0.5, 0.0, 1.0);
        // view dir from camera
        vec3 vdir = normalize(-viewPos.xyz);
        vRim = pow(1.0 - max(0.0, dot(n, vdir)), 1.8);
        gl_Position = u_proj * viewPos;
        // perspective-correct point size
        float size = u_pointSize * clamp(120.0 / max(0.1, vDepth), 0.5, 24.0);
        gl_PointSize = size;
      }
    `.trim());
    this.gl.compileShader(vs);

    const fs = this.gl.createShader(this.gl.FRAGMENT_SHADER);
    this.gl.shaderSource(fs, `
      #version 300 es
      precision ${this.floatPrecision} float;
      out vec4 fragColor;
      uniform vec4 u_color;
      uniform vec3 u_keyColor;
      uniform vec3 u_rimColor;
      uniform vec3 u_fogColor;
      uniform float u_fogNear;
      uniform float u_fogFar;
      in float vDepth;
      in float vLight;
      in float vRim;
      void main(){
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float d = dot(uv, uv);
        float shape = smoothstep(1.0, 0.5, d);
        if (shape <= 0.02) discard;
        // Arcane-style: warm key + cool rim
        vec3 warm = u_keyColor * (0.2 + 0.8 * vLight);
        vec3 cool = u_rimColor * (0.15 + 0.85 * clamp(vRim, 0.0, 1.0));
        vec3 lit = mix(warm, cool, 0.45);
        // Fog blend
        float fog = clamp((vDepth - u_fogNear) / max(0.001, (u_fogFar - u_fogNear)), 0.0, 1.0);
        vec3 color = mix(lit, u_fogColor, fog);
        // Filmic grain (screen-space dither)
        float grain = fract(sin(dot(gl_FragCoord.xy , vec2(12.9898,78.233))) * 43758.5453);
        color += (grain - 0.5) * 0.02;
        float alpha = u_color.a * shape * (1.0 - 0.5 * fog);
        fragColor = vec4(color, alpha);
      }
    `.trim());
    this.gl.compileShader(fs);

    this.prog = this.gl.createProgram();
    this.gl.attachShader(this.prog, vs);
    this.gl.attachShader(this.prog, fs);
    this.gl.linkProgram(this.prog);
    this.aPos = this.gl.getAttribLocation(this.prog, 'aPos');
    this.uSize = this.gl.getUniformLocation(this.prog, 'u_pointSize');
    this.uColor = this.gl.getUniformLocation(this.prog, 'u_color');
    this.uScale = this.gl.getUniformLocation(this.prog, 'u_scale');
    this.uSpin = this.gl.getUniformLocation(this.prog, 'u_spin');
    this.uView = this.gl.getUniformLocation(this.prog, 'u_view');
    this.uProj = this.gl.getUniformLocation(this.prog, 'u_proj');
    this.uLightDir = this.gl.getUniformLocation(this.prog, 'u_lightDir');
    this.uFogNear = this.gl.getUniformLocation(this.prog, 'u_fogNear');
    this.uFogFar = this.gl.getUniformLocation(this.prog, 'u_fogFar');
    this.uKeyColor = this.gl.getUniformLocation(this.prog, 'u_keyColor');
    this.uRimColor = this.gl.getUniformLocation(this.prog, 'u_rimColor');
    this.uFogColor = this.gl.getUniformLocation(this.prog, 'u_fogColor');
  }

  async loadOBJFromURL(url, sampleEvery = 4) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`Model fetch failed (${res.status}): ${url}`);
    }
    const text = await res.text();
    return this.loadOBJFromString(text, sampleEvery);
  }

  loadOBJFromString(text, sampleEvery = 4) {
    const step = Math.max(1, sampleEvery | 0);
    const verts = parseOBJToPoints(text, step);
    if (verts.length === 0) {
      throw new Error('Model contains no vertices after parsing');
    }
    // Determine dominant axis to align upright (Y-up). Swap axes if needed.
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i], y = verts[i+1], z = verts[i+2];
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
    const range = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    let dominant = 1; // assume Y
    if (range[0] >= range[1] && range[0] >= range[2]) dominant = 0;
    else if (range[2] >= range[0] && range[2] >= range[1]) dominant = 2;

    // Build mapping orig -> new axes so dominant -> Y
    // Start identity mapping [X,Y,Z]
    let map = [0,1,2];
    if (dominant === 0) { // X is tallest -> swap X<->Y
      map = [1,0,2];
    } else if (dominant === 2) { // Z is tallest -> swap Z<->Y
      map = [0,2,1];
    }

    // Decide Y sign so top is positive. Compare |max| vs |min| along dominant axis.
    const domMax = max[dominant];
    const domMin = min[dominant];
    const ySign = (Math.abs(domMax) >= Math.abs(domMin)) ? 1 : -1;

    // First, remap and apply ySign, then compute center/scale
    const remapped = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      const orig = [verts[i], verts[i+1], verts[i+2]];
      remapped[i]   = orig[map[0]];
      remapped[i+1] = ySign * orig[map[1]];
      remapped[i+2] = orig[map[2]];
    }
    let minR = [Infinity, Infinity, Infinity];
    let maxR = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < remapped.length; i += 3) {
      const x = remapped[i], y = remapped[i+1], z = remapped[i+2];
      if (x < minR[0]) minR[0] = x; if (x > maxR[0]) maxR[0] = x;
      if (y < minR[1]) minR[1] = y; if (y > maxR[1]) maxR[1] = y;
      if (z < minR[2]) minR[2] = z; if (z > maxR[2]) maxR[2] = z;
    }
    const c = [(minR[0] + maxR[0]) * 0.5, (minR[1] + maxR[1]) * 0.5, (minR[2] + maxR[2]) * 0.5];
    const extent = Math.max(maxR[0] - minR[0], maxR[1] - minR[1], maxR[2] - minR[2]) || 1;
    const normScale = 1.6 / extent; // fit within clip space comfortably
    const normalized = new Float32Array(remapped.length);
    for (let i = 0; i < remapped.length; i += 3) {
      normalized[i]   = (remapped[i]   - c[0]) * normScale;
      normalized[i+1] = (remapped[i+1] - c[1]) * normScale;
      normalized[i+2] = (remapped[i+2] - c[2]) * normScale;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, normalized, this.gl.STATIC_DRAW);
    this.count = normalized.length / 3;

    // Store framing info for camera: normalized height and face Y
    const heightNorm = (maxR[1] - minR[1]) * normScale;
    const headYNorm = (maxR[1] - c[1]) * normScale;
    this._framing = {
      height: heightNorm,
      faceY: headYNorm - 0.08 * heightNorm, // a little below the top
      centerY: ( (minR[1] + maxR[1]) * 0.5 - c[1]) * normScale,
    };
    // Default target to face
    this.camera.target = [0, this._framing.faceY, 0];
  }

  getFramingInfo() {
    return this._framing || { height: 1.0, faceY: 0.5, centerY: 0.0 };
  }

  draw(dt, alphaOverride) {
    if (!this.enabled || this.count === 0) return;
    this.spin += dt * this.spinSpeed;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.aPos);
    gl.uniform1f(this.uSize, this.pointSize);
    if (alphaOverride != null) {
      const a = Math.max(0, Math.min(1, alphaOverride));
      const c = this.color;
      gl.uniform4fv(this.uColor, new Float32Array([c[0], c[1], c[2], c[3] * a]));
    } else {
      gl.uniform4fv(this.uColor, this.color);
    }
    gl.uniform1f(this.uScale, this.scale);
    gl.uniform1f(this.uSpin, this.spin);
    // Camera uniforms
    const cam = this.camera;
    const view = ParticleModel._lookAt(cam.eye, cam.target, cam.up);
    const proj = ParticleModel._perspective(cam.fov, cam.aspect, cam.near, cam.far);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    // Light and fog
    const ld = ParticleModel._normalize(cam.lightDir);
    gl.uniform3fv(this.uLightDir, new Float32Array(ld));
    gl.uniform1f(this.uFogNear, cam.fogNear);
    gl.uniform1f(this.uFogFar, cam.fogFar);
    gl.uniform3fv(this.uKeyColor, new Float32Array(this.keyColor));
    gl.uniform3fv(this.uRimColor, new Float32Array(this.rimColor));
    gl.uniform3fv(this.uFogColor, new Float32Array(this.fogColor));
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }
}


