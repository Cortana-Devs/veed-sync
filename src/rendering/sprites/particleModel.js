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
      uniform float u_fogNear;
      uniform float u_fogFar;
      in float vDepth;
      in float vLight;
      void main(){
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float d = dot(uv, uv);
        float shape = smoothstep(1.0, 0.5, d);
        if (shape <= 0.02) discard;
        // simple lambert + color
        vec3 base = u_color.rgb * (0.35 + 0.75 * vLight);
        float fog = clamp((vDepth - u_fogNear) / max(0.001, (u_fogFar - u_fogNear)), 0.0, 1.0);
        float alpha = u_color.a * shape * (1.0 - 0.6 * fog);
        fragColor = vec4(base, alpha);
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
    // Normalize to centered unit cube so models are visible by default
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i], y = verts[i+1], z = verts[i+2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const normScale = 1.6 / extent; // fit within clip space comfortably
    const normalized = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      normalized[i]   = (verts[i]   - cx) * normScale;
      normalized[i+1] = (verts[i+1] - cy) * normScale;
      normalized[i+2] = (verts[i+2] - cz) * normScale;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, normalized, this.gl.STATIC_DRAW);
    this.count = normalized.length / 3;
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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }
}


