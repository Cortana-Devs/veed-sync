import ShaderUtils from "../shaders/shaderUtils";

export default class Particles {
  constructor(gl, opts = {}) {
    this.gl = gl;

    this.enabled = false;
    this.maxCount = opts.maxCount || 500;
    this.pointSize = opts.pointSize || 6.0;
    this.speed = opts.speed || 1.0;
    this.color = opts.color || [0.75, 1.0, 0.2, 0.85];

    this.aspectx = opts.aspectx || 1;
    this.aspecty = opts.aspecty || 1;

    this.positions = new Float32Array(this.maxCount * 2);
    this.velocities = new Float32Array(this.maxCount * 2);
    this.lifetimes = new Float32Array(this.maxCount);

    this.floatPrecision = ShaderUtils.getFragmentFloatPrecision(this.gl);
    this.createShader();

    this.posBuf = this.gl.createBuffer();

    this.resetAll();
  }

  updateGlobals(opts) {
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  configure({ maxCount, pointSize, speed, color } = {}) {
    if (typeof maxCount === "number" && maxCount > 0) {
      const newMax = Math.min(5000, Math.floor(maxCount));
      if (newMax !== this.maxCount) {
        this.maxCount = newMax;
        this.positions = new Float32Array(this.maxCount * 2);
        this.velocities = new Float32Array(this.maxCount * 2);
        this.lifetimes = new Float32Array(this.maxCount);
        this.resetAll();
      }
    }
    if (typeof pointSize === "number") this.pointSize = pointSize;
    if (typeof speed === "number") this.speed = speed;
    if (Array.isArray(color) && color.length === 4) this.color = color;
  }

  resetAll() {
    for (let i = 0; i < this.maxCount; i++) {
      this.spawn(i);
    }
  }

  spawn(i) {
    // Spawn near center with slight jitter
    const ix = i * 2;
    this.positions[ix + 0] = (Math.random() - 0.5) * 0.1;
    this.positions[ix + 1] = (Math.random() - 0.5) * 0.1;

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.15 + Math.random() * 0.5;
    this.velocities[ix + 0] = Math.cos(angle) * speed;
    this.velocities[ix + 1] = Math.sin(angle) * speed;

    this.lifetimes[i] = 0.5 + Math.random() * 1.5;
  }

  createShader() {
    this.shaderProgram = this.gl.createProgram();

    const vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
    this.gl.shaderSource(
      vertShader,
      `
      #version 300 es
      in vec2 aPos;
      uniform float u_pointSize;
      void main(void) {
        gl_Position = vec4(aPos.xy, 0.0, 1.0);
        gl_PointSize = u_pointSize;
      }
      `.trim()
    );
    this.gl.compileShader(vertShader);

    const fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
    this.gl.shaderSource(
      fragShader,
      `
      #version 300 es
      precision ${this.floatPrecision} float;
      out vec4 fragColor;
      uniform vec4 u_color;
      void main(void) {
        // radial falloff circle
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float d = dot(uv, uv);
        float alpha = smoothstep(1.0, 0.65, d);
        fragColor = vec4(u_color.rgb, u_color.a * alpha);
        if (alpha <= 0.01) discard;
      }
      `.trim()
    );
    this.gl.compileShader(fragShader);

    this.gl.attachShader(this.shaderProgram, vertShader);
    this.gl.attachShader(this.shaderProgram, fragShader);
    this.gl.linkProgram(this.shaderProgram);

    this.aPosLoc = this.gl.getAttribLocation(this.shaderProgram, "aPos");
    this.uSizeLoc = this.gl.getUniformLocation(this.shaderProgram, "u_pointSize");
    this.uColorLoc = this.gl.getUniformLocation(this.shaderProgram, "u_color");
  }

  update(dt, audioLevels) {
    if (!this.enabled) return;
    const bass = (audioLevels?.bass || 0) + (audioLevels?.bass_att || 0);
    const mid = (audioLevels?.mid || 0) + (audioLevels?.mid_att || 0);
    const treb = (audioLevels?.treb || 0) + (audioLevels?.treb_att || 0);
    const energy = (0.6 * bass + 0.3 * mid + 0.1 * treb) * 0.5;

    const accelScale = this.speed * (0.3 + energy);
    for (let i = 0; i < this.maxCount; i++) {
      const ix = i * 2;
      // simple outward acceleration proportional to position
      const ax = this.positions[ix + 0] * 0.0 + (Math.random() - 0.5) * 0.1 * accelScale;
      const ay = this.positions[ix + 1] * 0.0 + (Math.random() - 0.5) * 0.1 * accelScale;

      this.velocities[ix + 0] += ax * dt;
      this.velocities[ix + 1] += ay * dt;

      this.positions[ix + 0] += this.velocities[ix + 0] * dt * 0.5;
      this.positions[ix + 1] += this.velocities[ix + 1] * dt * 0.5;

      this.lifetimes[i] -= dt * (0.4 + energy * 0.6);

      // respawn when out of bound or dead
      if (
        this.lifetimes[i] <= 0.0 ||
        Math.abs(this.positions[ix + 0]) > 1.2 ||
        Math.abs(this.positions[ix + 1]) > 1.2
      ) {
        this.spawn(i);
      }
    }
  }

  drawParticles(dt, audioLevels) {
    if (!this.enabled) return;

    this.update(dt, audioLevels);

    const gl = this.gl;
    gl.useProgram(this.shaderProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.aPosLoc);

    gl.uniform1f(this.uSizeLoc, this.pointSize);
    gl.uniform4fv(this.uColorLoc, this.color);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, this.maxCount);
  }
}


