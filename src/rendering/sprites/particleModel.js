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

  createShader() {
    const vs = this.gl.createShader(this.gl.VERTEX_SHADER);
    this.gl.shaderSource(vs, `
      #version 300 es
      in vec3 aPos;
      uniform float u_pointSize;
      uniform float u_scale;
      uniform float u_spin;
      void main(){
        // simple spin around Y, then scale to clip space-ish
        float c = cos(u_spin), s = sin(u_spin);
        vec3 p = vec3( aPos.x*c + aPos.z*s, aPos.y, -aPos.x*s + aPos.z*c );
        vec3 q = p * u_scale;
        gl_Position = vec4(q.xy, 0.0, 1.0);
        gl_PointSize = u_pointSize;
      }
    `.trim());
    this.gl.compileShader(vs);

    const fs = this.gl.createShader(this.gl.FRAGMENT_SHADER);
    this.gl.shaderSource(fs, `
      #version 300 es
      precision ${this.floatPrecision} float;
      out vec4 fragColor;
      uniform vec4 u_color;
      void main(){
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float d = dot(uv, uv);
        float a = smoothstep(1.0, 0.5, d);
        if (a <= 0.02) discard;
        fragColor = vec4(u_color.rgb, u_color.a * a);
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
  }

  async loadOBJFromURL(url, sampleEvery = 4) {
    const res = await fetch(url, { cache: 'force-cache' });
    const text = await res.text();
    return this.loadOBJFromString(text, sampleEvery);
  }

  loadOBJFromString(text, sampleEvery = 4) {
    const verts = parseOBJToPoints(text, sampleEvery);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, verts, this.gl.STATIC_DRAW);
    this.count = verts.length / 3;
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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }
}


