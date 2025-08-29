// Minimal WebGPU compositor that blits from a canvas to the screen.
// Experimental: guarded by feature detection in Visualizer.

export default class WebGPUCompositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.ctx = null;
    this.format = 'bgra8unorm';
    this.pipeline = null; // basic blit
    this.pipelines = {};  // effectName -> pipeline
    this.sampler = null;
    this.bindGroupLayout = null;
    this.uniformBuffer = null;
    this.uniformBindGroupLayout = null;
    this.uniformBindGroup = null;
    this.uniformArray = new Float32Array(16);
    this.postTexture = null;
    this._targetW = 0;
    this._targetH = 0;
  }

  async init() {
    if (!('gpu' in navigator)) throw new Error('WebGPU not supported');
    this.ctx = this.canvas.getContext('webgpu');
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });

    const shaderModule = this.device.createShaderModule({
      code: `
        @vertex fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4f {
          var pos = array<vec2f, 6>(
            vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
            vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
          );
          return vec4f(pos[VertexIndex], 0.0, 1.0);
        }

        @group(0) @binding(0) var samp : sampler;
        @group(0) @binding(1) var tex  : texture_2d<f32>;

        @fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(f32(textureDimensions(tex).x), f32(textureDimensions(tex).y));
          // Convert screen coords to 0..1 uv
          let uv01 = vec2f(uv.x, 1.0 - uv.y);
          let color = textureSampleLevel(tex, samp, uv01, 0.0);
          return vec4f(color.rgb, 1.0);
        }
      `
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // Uniforms (vec4x4) for effects
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBindGroupLayout = this.device.createBindGroupLayout({
      entries: [ { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } } ]
    });

    // Build effect pipelines
    await this._buildEffectPipelines();
  }

  // Present an ImageBitmap onto the WebGPU canvas
  async presentFromBitmap(bitmap) {
    if (!this.device || !this.ctx) return;

    const srcTexture = this.device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
    });

    // Copy bitmap into GPU texture
    await this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: srcTexture },
      [bitmap.width, bitmap.height]
    );

    const view = this.ctx.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder();

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: srcTexture.createView() },
      ]
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, 1, 0, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    srcTexture.destroy();
  }

  async presentPostEffectFromBitmap(bitmap, uniforms, effectName = 'pulsebloom') {
    if (!this.device || !this.ctx) return;
    const srcTexture = this.device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
    });
    await this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: srcTexture },
      [bitmap.width, bitmap.height]
    );

    // Pack uniforms (vec4x4)
    // v0: res.x, res.y, time, bpm
    // v1: beatPhase, barPhase, confidence, flux
    // v2: band0, band1, band2, param1
    // v3: param2, param3, param4, 0
    this.uniformArray[0] = uniforms.resolution[0] || this.canvas.width;
    this.uniformArray[1] = uniforms.resolution[1] || this.canvas.height;
    this.uniformArray[2] = uniforms.time || 0;
    this.uniformArray[3] = uniforms.bpm || 120;
    this.uniformArray[4] = uniforms.beatPhase || 0;
    this.uniformArray[5] = uniforms.barPhase || 0;
    this.uniformArray[6] = uniforms.confidence || 0;
    this.uniformArray[7] = uniforms.flux || 0;
    this.uniformArray[8] = uniforms.band ? uniforms.band[0] || 0 : 0;
    this.uniformArray[9] = uniforms.band ? uniforms.band[1] || 0 : 0;
    this.uniformArray[10] = uniforms.band ? uniforms.band[2] || 0 : 0;
    this.uniformArray[11] = uniforms.param1 || 0;
    this.uniformArray[12] = uniforms.param2 || 0;
    this.uniformArray[13] = uniforms.param3 || 0;
    this.uniformArray[14] = uniforms.param4 || 0;
    this.uniformArray[15] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray.buffer);

    this._ensurePostTarget(bitmap.width, bitmap.height);
    const encoder = this.device.createCommandEncoder();

    const bindGroupTex = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [ { binding: 0, resource: this.sampler }, { binding: 1, resource: srcTexture.createView() } ]
    });
    const bindGroupUbo = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [ { binding: 0, resource: { buffer: this.uniformBuffer } } ]
    });

    // Render effect to postTexture
    const pass = encoder.beginRenderPass({
      colorAttachments: [ { view: this.postTexture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' } ]
    });

    const pipe = this.pipelines[effectName] || this.pipeline;
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bindGroupTex);
    if (pipe._hasUniforms) pass.setBindGroup(1, bindGroupUbo);
    pass.draw(6, 1, 0, 0);
    pass.end();
    // Blit to screen
    const viewOut = this.ctx.getCurrentTexture().createView();
    const pass2 = encoder.beginRenderPass({ colorAttachments: [ { view: viewOut, clearValue: { r:0,g:0,b:0,a:1 }, loadOp: 'clear', storeOp: 'store' } ] });
    const blitBG = this.device.createBindGroup({ layout: this.bindGroupLayout, entries: [ { binding: 0, resource: this.sampler }, { binding: 1, resource: this.postTexture.createView() } ] });
    pass2.setPipeline(this.pipeline);
    pass2.setBindGroup(0, blitBG);
    pass2.draw(6,1,0,0);
    pass2.end();

    this.device.queue.submit([encoder.finish()]);
    srcTexture.destroy();
  }

  async _buildEffectPipelines() {
    // PulseBloom: thresholded highlight + soft taps
    const pulseWGSL = `
      struct U { v0: vec4f; v1: vec4f; v2: vec4f; v3: vec4f; };
      @group(1) @binding(0) var<uniform> u : U;
      @group(0) @binding(0) var samp : sampler;
      @group(0) @binding(1) var tex  : texture_2d<f32>;
      fn getUV(pos: vec4f) -> vec2f {
        let res = u.v0.xy; let uv = pos.xy / res; return vec2f(uv.x, 1.0 - uv.y);
      }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
        return vec4f(p[i],0.,1.);
      }
      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let uv = getUV(pos);
        let t = u.v0.z; let bpm = max(u.v0.w, 1.);
        let bass = u.v2.x; let conf = u.v1.z;
        let base = textureSampleLevel(tex, samp, uv, 0.0).rgb;
        // threshold highlights
        let thr = mix(0.72, 0.56, clamp(bass*0.35, 0.0, 1.0));
        let hi = max(base - vec3f(thr), vec3f(0.0));
        var bloom = hi * 1.15;
        // cheap blur taps
        let px = 1.0 / u.v0.x; let py = 1.0 / u.v0.y;
        let off = vec2f(px, py) * (0.8 + 1.2*bass);
        bloom += textureSampleLevel(tex, samp, uv + off, 0.0).rgb * 0.12;
        bloom += textureSampleLevel(tex, samp, uv - off, 0.0).rgb * 0.12;
        bloom += textureSampleLevel(tex, samp, uv + vec2f(off.x, -off.y), 0.0).rgb * 0.12;
        bloom += textureSampleLevel(tex, samp, uv + vec2f(-off.x, off.y), 0.0).rgb * 0.12;
        let beatPulse = 0.25 * conf * (0.5 + 0.5 * sin(t * 6.2831853 * (bpm/60.0)));
        let color = base + bloom * (0.28 + beatPulse);
        return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
      }
    `;
    this.pipelines['pulsebloom'] = this._createEffectPipeline(pulseWGSL, true);

    // NeonGlitch: chroma shift and tearing based on treble
    const glitchWGSL = `
      struct U { v0: vec4f; v1: vec4f; v2: vec4f; v3: vec4f; };
      @group(1) @binding(0) var<uniform> u : U;
      @group(0) @binding(0) var samp : sampler;
      @group(0) @binding(1) var tex  : texture_2d<f32>;
      fn getUV(pos: vec4f) -> vec2f { let res = u.v0.xy; let uv = pos.xy / res; return vec2f(uv.x, 1.0 - uv.y); }
      fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898,78.233))) * 43758.5453); }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
        return vec4f(p[i],0.,1.);
      }
      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let uv = getUV(pos);
        let t = u.v0.z; let treb = u.v2.z; let conf = u.v1.z;
        let shift = 0.0012 * clamp(treb*conf, 0.0, 2.0);
        // chromatic offsets
        let r = textureSampleLevel(tex, samp, uv + vec2f( shift, 0.0), 0.0).r;
        let g = textureSampleLevel(tex, samp, uv, 0.0).g;
        let b = textureSampleLevel(tex, samp, uv + vec2f(-shift, 0.0), 0.0).b;
        var col = vec3f(r,g,b);
        // horizontal tear
        let tearY = fract(t * 0.37 + hash(vec2f(t, uv.x)));
        if (abs(uv.y - tearY) < 0.0015 + 0.006*treb) {
          let xoff = 0.012 * (hash(vec2f(uv.y, t)) - 0.5) * treb;
          col = textureSampleLevel(tex, samp, uv + vec2f(xoff, 0.0), 0.0).rgb;
        }
        return vec4f(col, 1.0);
      }
    `;
    this.pipelines['neonglitch'] = this._createEffectPipeline(glitchWGSL, true);

    // SpectralTrails (post): directional multi-tap trail driven by mid band/flux
    const trailsWGSL = `
      struct U { v0: vec4f; v1: vec4f; v2: vec4f; v3: vec4f; };
      @group(1) @binding(0) var<uniform> u : U;
      @group(0) @binding(0) var samp : sampler;
      @group(0) @binding(1) var tex  : texture_2d<f32>;
      fn getUV(pos: vec4f) -> vec2f { let res = u.v0.xy; let uv = pos.xy / res; return vec2f(uv.x, 1.0 - uv.y); }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
        return vec4f(p[i],0.,1.);
      }
      @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        let uv = getUV(pos);
        let t = u.v0.z; let mid = u.v2.y; let conf = u.v1.z; let flux = u.v1.w;
        let dir = normalize(vec2f(sin(t*0.63 + flux*0.3), cos(t*0.47 - flux*0.2)));
        let steps:i32 = 5;
        let stride = (0.0025 + 0.009 * clamp(mid, 0.0, 2.0)) * (0.45 + 0.55*conf);
        var col = vec3f(0.0);
        var wsum = 0.0;
        for (var i:i32 = -steps; i <= steps; i++) {
          let f = f32(i);
          let w = 1.0 / (1.0 + abs(f));
          let sampUV = uv + dir * stride * f;
          col += textureSampleLevel(tex, samp, sampUV, 0.0).rgb * w;
          wsum += w;
        }
        col /= max(wsum, 0.0001);
        return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
      }
    `;
    this.pipelines['spectraltrails'] = this._createEffectPipeline(trailsWGSL, true);
  }

  _createEffectPipeline(code, hasUniforms) {
    const module = this.device.createShaderModule({ code });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [ this.bindGroupLayout, this.uniformBindGroupLayout ] });
    const pipeline = this.device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });
    pipeline._hasUniforms = !!hasUniforms;
    return pipeline;
  }

  _createPureEffectPipeline(code) {
    const module = this.device.createShaderModule({ code });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [ this.uniformBindGroupLayout ] });
    const pipeline = this.device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });
    pipeline._pure = true;
    return pipeline;
  }

  async presentPureEffect(uniforms, effectName = 'vectorscope2d_pure') {
    if (!this.device || !this.ctx) return;
    // pack uniforms
    this.uniformArray[0] = uniforms.resolution?.[0] || this.canvas.width;
    this.uniformArray[1] = uniforms.resolution?.[1] || this.canvas.height;
    this.uniformArray[2] = uniforms.time || 0;
    this.uniformArray[3] = uniforms.bpm || 120;
    this.uniformArray[4] = uniforms.beatPhase || 0;
    this.uniformArray[5] = uniforms.barPhase || 0;
    this.uniformArray[6] = uniforms.confidence || 0;
    this.uniformArray[7] = uniforms.flux || 0;
    this.uniformArray[8] = uniforms.band ? uniforms.band[0] || 0 : 0;
    this.uniformArray[9] = uniforms.band ? uniforms.band[1] || 0 : 0;
    this.uniformArray[10] = uniforms.band ? uniforms.band[2] || 0 : 0;
    this.uniformArray[11] = uniforms.param1 || 0;
    this.uniformArray[12] = uniforms.param2 || 0;
    this.uniformArray[13] = uniforms.param3 || 0;
    this.uniformArray[14] = uniforms.param4 || 0;
    this.uniformArray[15] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray.buffer);

    const encoder = this.device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({ colorAttachments: [ { view, clearValue: { r:0,g:0,b:0,a:1 }, loadOp: 'clear', storeOp: 'store' } ] });
    const pipe = this.pipelines[effectName];
    const bindUBO = this.device.createBindGroup({ layout: this.uniformBindGroupLayout, entries: [ { binding: 0, resource: { buffer: this.uniformBuffer } } ] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bindUBO);
    pass.draw(6,1,0,0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose() {
    try { if (this.uniformBuffer) this.device.destroy(); } catch (_) {}
    // Note: Most WebGPU resources are released with device/context lifecycle
  }

  _ensurePostTarget(w, h) {
    if (this.postTexture && this._targetW === w && this._targetH === h) return;
    this._targetW = w; this._targetH = h;
    if (this.postTexture) this.postTexture.destroy();
    this.postTexture = this.device.createTexture({ size: [w,h,1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  }
}


