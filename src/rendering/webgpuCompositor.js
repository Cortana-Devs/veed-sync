// Minimal WebGPU compositor that blits from a canvas to the screen.
// Experimental: guarded by feature detection in Visualizer.

export default class WebGPUCompositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.ctx = null;
    this.format = 'bgra8unorm';
    this.pipeline = null;
    this.sampler = null;
    this.bindGroupLayout = null;
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
}


