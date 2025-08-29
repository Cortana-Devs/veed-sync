import AudioLevels from "../audio/audioLevels";
import AudioFeatures from "../audio/audioFeatures";
import blankPreset from "../blankPreset";
import PresetEquationRunner from "../equations/presetEquationRunner";
import PresetEquationRunnerWASM from "../equations/presetEquationRunnerWASM";
import BasicWaveform from "./waves/basicWaveform";
import CustomWaveform from "./waves/customWaveform";
import CustomShape from "./shapes/customShape";
import Border from "./sprites/border";
import DarkenCenter from "./sprites/darkenCenter";
import MotionVectors from "./motionVectors/motionVectors";
import WarpShader from "./shaders/warp";
import CompShader from "./shaders/comp";
import OutputShader from "./shaders/output";
import ResampleShader from "./shaders/resample";
import BlurShader from "./shaders/blur/blur";
import Noise from "../noise/noise";
import ImageTextures from "../image/imageTextures";
import TitleText from "./text/titleText";
import BlendPattern from "./blendPattern";
import Utils from "../utils";
import Particles from "./sprites/particles";
import ParticleModel from "./sprites/particleModel";
import Scenes, { listScenes as listSceneDefs } from "./scenes";

export default class Renderer {
  constructor(gl, audio, opts) {
    this.gl = gl;
    this.audio = audio;
    this.beatSync = null;      // legacy
    this.momentSync = null;    // legacy
    this.syncEngine = null;    // unified

    this.frameNum = 0;
    this.fps = 30;
    this.time = 0;
    this.presetTime = 0;
    this.lastTime = performance.now();
    this.timeHist = [0];
    this.timeHistMax = 120;
    this.blending = false;
    this.blendStartTime = 0;
    this.blendProgress = 0;
    this.blendDuration = 0;

    this.width = opts.width || 1200;
    this.height = opts.height || 900;
    this.mesh_width = opts.meshWidth || 48;
    this.mesh_height = opts.meshHeight || 36;
    this.pixelRatio = opts.pixelRatio || window.devicePixelRatio || 1;
    this.textureRatio = opts.textureRatio || 1;
    this.outputFXAA = opts.outputFXAA || false;
    this.texsizeX = this.width * this.pixelRatio * this.textureRatio;
    this.texsizeY = this.height * this.pixelRatio * this.textureRatio;
    this.aspectx =
      this.texsizeY > this.texsizeX ? this.texsizeX / this.texsizeY : 1;
    this.aspecty =
      this.texsizeX > this.texsizeY ? this.texsizeY / this.texsizeX : 1;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;

    this.qs = Utils.range(1, 33).map((x) => `q${x}`);
    this.ts = Utils.range(1, 9).map((x) => `t${x}`);
    this.regs = Utils.range(0, 100).map((x) => {
      if (x < 10) {
        return `reg0${x}`;
      }
      return `reg${x}`;
    });

    this.blurRatios = [
      [0.5, 0.25],
      [0.125, 0.125],
      [0.0625, 0.0625],
    ];

    this.audioLevels = new AudioLevels(this.audio);
    this.audioFeatures = new AudioFeatures(this.audio);

    this.prevFrameBuffer = this.gl.createFramebuffer();
    this.targetFrameBuffer = this.gl.createFramebuffer();
    this.prevTexture = this.gl.createTexture();
    this.targetTexture = this.gl.createTexture();

    this.compFrameBuffer = this.gl.createFramebuffer();
    this.compTexture = this.gl.createTexture();

    this.anisoExt =
      this.gl.getExtension("EXT_texture_filter_anisotropic") ||
      this.gl.getExtension("MOZ_EXT_texture_filter_anisotropic") ||
      this.gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");

    this.bindFrameBufferTexture(this.prevFrameBuffer, this.prevTexture);
    this.bindFrameBufferTexture(this.targetFrameBuffer, this.targetTexture);
    this.bindFrameBufferTexture(this.compFrameBuffer, this.compTexture);

    const params = {
      pixelRatio: this.pixelRatio,
      textureRatio: this.textureRatio,
      texsizeX: this.texsizeX,
      texsizeY: this.texsizeY,
      mesh_width: this.mesh_width,
      mesh_height: this.mesh_height,
      aspectx: this.aspectx,
      aspecty: this.aspecty,
    };
    this.noise = new Noise(gl);
    this.image = new ImageTextures(gl);
    this.warpShader = new WarpShader(gl, this.noise, this.image, params);
    this.compShader = new CompShader(gl, this.noise, this.image, params);
    this.outputShader = new OutputShader(gl, params);
    this.prevWarpShader = new WarpShader(gl, this.noise, this.image, params);
    this.prevCompShader = new CompShader(gl, this.noise, this.image, params);
    this.numBlurPasses = 0;
    this.blurShader1 = new BlurShader(0, this.blurRatios, gl, params);
    this.blurShader2 = new BlurShader(1, this.blurRatios, gl, params);
    this.blurShader3 = new BlurShader(2, this.blurRatios, gl, params);
    this.blurTexture1 = this.blurShader1.blurVerticalTexture;
    this.blurTexture2 = this.blurShader2.blurVerticalTexture;
    this.blurTexture3 = this.blurShader3.blurVerticalTexture;
    this.basicWaveform = new BasicWaveform(gl, params);
    this.customWaveforms = Utils.range(4).map(
      (i) => new CustomWaveform(i, gl, params)
    );
    this.customShapes = Utils.range(4).map(
      (i) => new CustomShape(i, gl, params)
    );
    this.prevCustomWaveforms = Utils.range(4).map(
      (i) => new CustomWaveform(i, gl, params)
    );
    this.prevCustomShapes = Utils.range(4).map(
      (i) => new CustomShape(i, gl, params)
    );
    this.darkenCenter = new DarkenCenter(gl, params);
    this.innerBorder = new Border(gl, params);
    this.outerBorder = new Border(gl, params);
    this.motionVectors = new MotionVectors(gl, params);
    this.titleText = new TitleText(gl, params);
    this.blendPattern = new BlendPattern(params);
    this.resampleShader = new ResampleShader(gl);
    this.particles = new Particles(gl, params);
    this.particles.setEnabled(false);
    this.particleModel = new ParticleModel(gl, params);
    this.particleModel.setEnabled(false);
    this.particleModelPrev = new ParticleModel(gl, params);
    this.particleModelPrev.setEnabled(false);

    // Model-effect controls
    this.modelEffectsEnabled = false;
    this.modelOnly = false;
    this.modelBlendTime = 1.2;
    this.modelBlendProgress = 1.0;
    this.modelTransitionActive = false;
    this.modelBase = { pointSize: 2.5, scale: 0.6, spinSpeed: 0.35 };

    // Cinematic camera state
    this.cameraShotActive = false;
    this.cameraShotT = 0;
    this.cameraShotDuration = 1.2;
    this.cameraShotFrom = { eye: [0, 0.6, 2.8], fov: 48 * Math.PI / 180 };
    this.cameraShotTo = { eye: [0, 0.62, 2.1], fov: 40 * Math.PI / 180 };
    this.lastShotTime = -5;
    this.energyEMA = 0;

    // Transition quantization state
    this.quantizeTransitions = false;
    this.quantizeBars = 1;
    this.pendingPreset = null;
    this._loadingImmediate = false;
    this._lastBarForQuant = 0;

    // Event router reactive state
    this._camNudgeZ = 0;      // forward dolly
    this._camNudgeSide = 0;   // side sway
    this._fovNarrow = 0;      // lens punch
    this._particlesBurst = 0; // particles burst boost
    this._grainSpark = 0;     // grain spark boost

    // FX gates (UI-controlled)
    this.fxGate = { bloom: true, bassShake: true, zoomBounce: true, cameraShots: true };

    // Post FX defaults
    this.postFX = {
      exposure: 0.0,      // stops
      tonemap: 0.0,       // 0..1
      saturation: 0.0,    // -1..+1
      contrast: 0.0,      // -1..+1
      vignette: 0.0,      // 0..1
      grain: 0.0,         // 0..1
      grainLuma: 0.75,    // 0..1
      tint: [1.0, 1.0, 1.0],
      bassShake: 0.0,         // 0..1
      bassShakeFreq: 2.0,     // Hz
      bassShakeZoom: 0.05,    // zoom strength
      zoomBounce: 0.0,        // 0..1, downbeat bounce zoom
      zoomBounceFreq: 1.5,    // Hz
    };

    // Global dark theme palette (enabled by default). Ensures mostly dark visuals
    this.darkTheme = {
      enabled: true,
      minExposure: -0.35,
      maxExposure: 0.18,
      minSaturation: -0.1,
      maxSaturation: 0.28,
      tonemapMin: 0.6,
      vignetteMin: 0.2,
      baseTint: [0.92, 0.96, 1.08], // deep space blue/cyan bias
      tintLerp: 0.22,
    };

    // Stability controls to reduce shakiness
    this.stab = {
      confThreshold: 0.55,            // minimum confidence for strong triggers
      energyEMAAlpha: 0.06,           // slower energy smoothing
      eventGateDivision: 8,           // gate reactive bumps on 8ths by default
      postFXLerp: 0.08,               // slower postFX smoothing
      postFXImpactScale: 0.7,         // scale down per-beat impact
      cameraCooldown: 1.6,            // longer cooldown between shots
      nudgeDecay: { z: 0.94, side: 0.93, fov: 0.94, particles: 0.90, grain: 0.88 },
      sideWobble: 0.06,               // base side wobble amplitude
    };

    // Vibe presets
    this._vibes = [
      {
        key: "sunset_beach",
        label: "Sunset Beach",
        postFX: {
          exposure: -0.08,
          tonemap: 0.85,
          saturation: 0.1,
          contrast: 0.06,
          vignette: 0.28,
          grain: 0.18,
          grainLuma: 0.85,
          tint: [1.02, 0.95, 0.94],
        },
      },
      {
        key: "neon_city",
        label: "Neon City",
        postFX: {
          exposure: 0.06,
          tonemap: 0.85,
          saturation: 0.22,
          contrast: 0.14,
          vignette: 0.32,
          grain: 0.16,
          grainLuma: 0.6,
          tint: [0.9, 1.02, 1.12],
        },
      },
      {
        key: "nature_doc",
        label: "Nature Documentary",
        postFX: {
          exposure: -0.12,
          tonemap: 0.9,
          saturation: -0.06,
          contrast: -0.02,
          vignette: 0.18,
          grain: 0.12,
          grainLuma: 1.0,
          tint: [0.98, 1.0, 1.02],
        },
      },
    ];
    this._vibeIndex = 0;

    this.supertext = {
      startTime: -1,
    };

    this.warpUVs = new Float32Array(
      (this.mesh_width + 1) * (this.mesh_height + 1) * 2
    );
    this.warpColor = new Float32Array(
      (this.mesh_width + 1) * (this.mesh_height + 1) * 4
    );

    this.gl.clearColor(0, 0, 0, 1);

    this.blankPreset = blankPreset;

    const globalVars = {
      frame: 0,
      time: 0,
      fps: 45,
      bass: 1,
      bass_att: 1,
      mid: 1,
      mid_att: 1,
      treb: 1,
      treb_att: 1,
    };

    this.preset = blankPreset;
    this.prevPreset = this.preset;
    this.presetEquationRunner = new PresetEquationRunner(
      this.preset,
      globalVars,
      params
    );
    this.prevPresetEquationRunner = new PresetEquationRunner(
      this.prevPreset,
      globalVars,
      params
    );

    if (!this.preset.useWASM) {
      this.regVars = this.presetEquationRunner.mdVSRegs;
    }
  }

  // Helpers for cinematic camera
  _mix(a, b, t) { return a * (1 - t) + b * t; }
  _easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
  _startCameraShot(energy) {
    this.cameraShotActive = true;
    this.cameraShotT = 0;
    // from current base eye at face level
    const framing = this.particleModel.getFramingInfo();
    const faceY = framing.faceY || 0.5;
    const baseZ = 2.4 - 0.35 * energy;
    const baseY = faceY + 0.06 + 0.08 * Math.sin(this.time * 0.45);
    this.cameraShotFrom = { eye: [0, baseY, baseZ], fov: 46 * Math.PI / 180 };
    // Target a close-up zoom towards the face
    const targetZ = Math.max(1.8, baseZ - 0.55);
    const targetY = faceY + 0.04;
    const targetFov = 40 * Math.PI / 180;
    this.cameraShotTo = { eye: [0.0, targetY, targetZ], fov: targetFov };
    this.cameraShotDuration = 0.9 + 0.6 * (1.0 - energy); // shorter on strong beats
  }

  static getHighestBlur(t) {
    if (/sampler_blur3/.test(t)) {
      return 3;
    } else if (/sampler_blur2/.test(t)) {
      return 2;
    } else if (/sampler_blur1/.test(t)) {
      return 1;
    }

    return 0;
  }

  loadPreset(preset, blendTime) {
    if (this.quantizeTransitions && !this._loadingImmediate && this.beatState) {
      // Defer transition to downbeat boundary
      this.pendingPreset = { preset, blendTime: Math.max(0, blendTime) };
      return;
    }

    this.blendPattern.createBlendPattern();
    this.blending = true;
    this.blendStartTime = this.time;
    this.blendDuration = blendTime;
    this.blendProgress = 0;

    this.prevPresetEquationRunner = this.presetEquationRunner;

    this.prevPreset = this.preset;
    this.preset = preset;

    this.presetTime = this.time;

    const globalVars = {
      frame: this.frameNum,
      time: this.time,
      fps: this.fps,
      bass: this.audioLevels.bass,
      bass_att: this.audioLevels.bass_att,
      mid: this.audioLevels.mid,
      mid_att: this.audioLevels.mid_att,
      treb: this.audioLevels.treb,
      treb_att: this.audioLevels.treb_att,
    };
    const params = {
      pixelRatio: this.pixelRatio,
      textureRatio: this.textureRatio,
      texsizeX: this.texsizeX,
      texsizeY: this.texsizeY,
      mesh_width: this.mesh_width,
      mesh_height: this.mesh_height,
      aspectx: this.aspectx,
      aspecty: this.aspecty,
    };

    if (preset.useWASM) {
      this.preset.globalPools.perFrame.old_wave_mode.value = this.prevPreset.baseVals.wave_mode;
      this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode;
      this.presetEquationRunner = new PresetEquationRunnerWASM(
        this.preset,
        globalVars,
        params
      );
      if (this.preset.pixel_eqs_initialize_array) {
        this.preset.pixel_eqs_initialize_array(
          this.mesh_width,
          this.mesh_height
        );
      }
    } else {
      this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode;
      this.presetEquationRunner = new PresetEquationRunner(
        this.preset,
        globalVars,
        params
      );
      this.regVars = this.presetEquationRunner.mdVSRegs;
    }

    const tmpWarpShader = this.prevWarpShader;
    this.prevWarpShader = this.warpShader;
    this.warpShader = tmpWarpShader;

    const tmpCompShader = this.prevCompShader;
    this.prevCompShader = this.compShader;
    this.compShader = tmpCompShader;

    const warpText = this.preset.warp.trim();
    const compText = this.preset.comp.trim();

    this.warpShader.updateShader(warpText);
    this.compShader.updateShader(compText);

    if (warpText.length === 0) {
      this.numBlurPasses = 0;
    } else {
      this.numBlurPasses = Renderer.getHighestBlur(warpText);
    }

    if (compText.length !== 0) {
      this.numBlurPasses = Math.max(
        this.numBlurPasses,
        Renderer.getHighestBlur(compText)
      );
    }
  }

  // Auto-cycle vibes on phrase boundaries (every 4 bars by default)
  enableAutoVibes(enabled = true, barsPerVibe = 4) {
    this.autoVibes = !!enabled;
    this.barsPerVibe = Math.max(1, barsPerVibe | 0);
    this._lastBarCount = this.beatState ? this.beatState.barCount : 0;
    this._lastVibeFire = this.beatState ? this.beatState.barCount : 0;
  }

  loadExtraImages(imageData) {
    this.image.loadExtraImages(imageData);
  }

  setRendererSize(width, height, opts) {
    const oldTexsizeX = this.texsizeX;
    const oldTexsizeY = this.texsizeY;

    this.width = width;
    this.height = height;
    this.mesh_width = opts.meshWidth || this.mesh_width;
    this.mesh_height = opts.meshHeight || this.mesh_height;
    this.pixelRatio = opts.pixelRatio || this.pixelRatio;
    this.textureRatio = opts.textureRatio || this.textureRatio;
    this.texsizeX = width * this.pixelRatio * this.textureRatio;
    this.texsizeY = height * this.pixelRatio * this.textureRatio;
    this.aspectx =
      this.texsizeY > this.texsizeX ? this.texsizeX / this.texsizeY : 1;
    this.aspecty =
      this.texsizeX > this.texsizeY ? this.texsizeY / this.texsizeX : 1;

    if (this.texsizeX !== oldTexsizeX || this.texsizeY !== oldTexsizeY) {
      // copy target texture, because we flip prev/target at start of render
      const targetTextureNew = this.gl.createTexture();
      this.bindFrameBufferTexture(this.targetFrameBuffer, targetTextureNew);
      this.bindFrambufferAndSetViewport(
        this.targetFrameBuffer,
        this.texsizeX,
        this.texsizeY
      );

      this.resampleShader.renderQuadTexture(this.targetTexture);

      this.targetTexture = targetTextureNew;

      this.bindFrameBufferTexture(this.prevFrameBuffer, this.prevTexture);
      this.bindFrameBufferTexture(this.compFrameBuffer, this.compTexture);
    }

    this.updateGlobals();

    // rerender current frame at new size
    if (this.frameNum > 0) {
      this.renderToScreen();
    }
  }

  setInternalMeshSize(width, height) {
    this.mesh_width = width;
    this.mesh_height = height;

    this.updateGlobals();
  }

  setOutputAA(useAA) {
    this.outputFXAA = useAA;
  }

  updateGlobals() {
    const params = {
      pixelRatio: this.pixelRatio,
      textureRatio: this.textureRatio,
      texsizeX: this.texsizeX,
      texsizeY: this.texsizeY,
      mesh_width: this.mesh_width,
      mesh_height: this.mesh_height,
      aspectx: this.aspectx,
      aspecty: this.aspecty,
    };
    this.presetEquationRunner.updateGlobals(params);
    this.prevPresetEquationRunner.updateGlobals(params);
    this.warpShader.updateGlobals(params);
    this.prevWarpShader.updateGlobals(params);
    this.compShader.updateGlobals(params);
    this.prevCompShader.updateGlobals(params);
    this.outputShader.updateGlobals(params);
    this.blurShader1.updateGlobals(params);
    this.blurShader2.updateGlobals(params);
    this.blurShader3.updateGlobals(params);
    this.basicWaveform.updateGlobals(params);
    this.customWaveforms.forEach((wave) => wave.updateGlobals(params));
    this.customShapes.forEach((shape) => shape.updateGlobals(params));
    this.prevCustomWaveforms.forEach((wave) => wave.updateGlobals(params));
    this.prevCustomShapes.forEach((shape) => shape.updateGlobals(params));
    this.darkenCenter.updateGlobals(params);
    this.innerBorder.updateGlobals(params);
    this.outerBorder.updateGlobals(params);
    this.motionVectors.updateGlobals(params);
    this.titleText.updateGlobals(params);
    this.blendPattern.updateGlobals(params);
    this.particles.updateGlobals(params);

    this.warpUVs = new Float32Array(
      (this.mesh_width + 1) * (this.mesh_height + 1) * 2
    );
    this.warpColor = new Float32Array(
      (this.mesh_width + 1) * (this.mesh_height + 1) * 4
    );

    if (this.preset.pixel_eqs_initialize_array) {
      this.preset.pixel_eqs_initialize_array(this.mesh_width, this.mesh_height);
    }
  }

  calcTimeAndFPS(elapsedTime) {
    let elapsed;
    if (elapsedTime) {
      elapsed = elapsedTime;
    } else {
      const newTime = performance.now();
      elapsed = (newTime - this.lastTime) / 1000.0;
      if (elapsed > 1.0 || elapsed < 0.0 || this.frameNum < 2) {
        elapsed = 1.0 / 30.0;
      }
      this.lastTime = newTime;
    }

    // Prefer audioContext time for tighter A/V alignment if available
    if (this.audio && this.audio.audioContext && typeof this.audio.audioContext.currentTime === 'number') {
      this.time = this.audio.audioContext.currentTime;
    } else {
      this.time += 1.0 / this.fps;
    }

    if (this.blending) {
      this.blendProgress =
        (this.time - this.blendStartTime) / this.blendDuration;
      if (this.blendProgress > 1.0) {
        this.blending = false;
      }
    }

    const newHistTime = this.timeHist[this.timeHist.length - 1] + elapsed;
    this.timeHist.push(newHistTime);
    if (this.timeHist.length > this.timeHistMax) {
      this.timeHist.shift();
    }

    const newFPS = this.timeHist.length / (newHistTime - this.timeHist[0]);
    if (Math.abs(newFPS - this.fps) > 3.0 && this.frameNum > this.timeHistMax) {
      this.fps = newFPS;
    } else {
      const damping = 0.93;
      this.fps = damping * this.fps + (1.0 - damping) * newFPS;
    }
  }

  runPixelEquations(presetEquationRunner, mdVSFrame, globalVars, blending) {
    const gridX = this.mesh_width;
    const gridZ = this.mesh_height;

    const gridX1 = gridX + 1;
    const gridZ1 = gridZ + 1;

    const warpTimeV = this.time * mdVSFrame.warpanimspeed;
    const warpScaleInv = 1.0 / mdVSFrame.warpscale;

    const warpf0 = 11.68 + 4.0 * Math.cos(warpTimeV * 1.413 + 10);
    const warpf1 = 8.77 + 3.0 * Math.cos(warpTimeV * 1.113 + 7);
    const warpf2 = 10.54 + 3.0 * Math.cos(warpTimeV * 1.233 + 3);
    const warpf3 = 11.49 + 4.0 * Math.cos(warpTimeV * 0.933 + 5);

    const texelOffsetX = 0.0 / this.texsizeX;
    const texelOffsetY = 0.0 / this.texsizeY;

    const aspectx = this.aspectx;
    const aspecty = this.aspecty;

    let offset = 0;
    let offsetColor = 0;
    if (!presetEquationRunner.preset.useWASM) {
      let mdVSVertex = Utils.cloneVars(mdVSFrame);

      let warp = mdVSVertex.warp;
      let zoom = mdVSVertex.zoom;
      let zoomExp = mdVSVertex.zoomexp;
      let cx = mdVSVertex.cx;
      let cy = mdVSVertex.cy;
      let sx = mdVSVertex.sx;
      let sy = mdVSVertex.sy;
      let dx = mdVSVertex.dx;
      let dy = mdVSVertex.dy;
      let rot = mdVSVertex.rot;

      for (let iz = 0; iz < gridZ1; iz++) {
        for (let ix = 0; ix < gridX1; ix++) {
          const x = (ix / gridX) * 2.0 - 1.0;
          const y = (iz / gridZ) * 2.0 - 1.0;
          const rad = Math.sqrt(
            x * x * aspectx * aspectx + y * y * aspecty * aspecty
          );

          if (presetEquationRunner.runVertEQs) {
            let ang;
            if (iz === gridZ / 2 && ix === gridX / 2) {
              ang = 0;
            } else {
              ang = Utils.atan2(y * aspecty, x * aspectx);
            }

            mdVSVertex.x = x * 0.5 * aspectx + 0.5;
            mdVSVertex.y = y * -0.5 * aspecty + 0.5;
            mdVSVertex.rad = rad;
            mdVSVertex.ang = ang;

            mdVSVertex.zoom = mdVSFrame.zoom;
            mdVSVertex.zoomexp = mdVSFrame.zoomexp;
            mdVSVertex.rot = mdVSFrame.rot;
            mdVSVertex.warp = mdVSFrame.warp;
            mdVSVertex.cx = mdVSFrame.cx;
            mdVSVertex.cy = mdVSFrame.cy;
            mdVSVertex.dx = mdVSFrame.dx;
            mdVSVertex.dy = mdVSFrame.dy;
            mdVSVertex.sx = mdVSFrame.sx;
            mdVSVertex.sy = mdVSFrame.sy;

            mdVSVertex = presetEquationRunner.runPixelEquations(mdVSVertex);

            warp = mdVSVertex.warp;
            zoom = mdVSVertex.zoom;
            zoomExp = mdVSVertex.zoomexp;
            cx = mdVSVertex.cx;
            cy = mdVSVertex.cy;
            sx = mdVSVertex.sx;
            sy = mdVSVertex.sy;
            dx = mdVSVertex.dx;
            dy = mdVSVertex.dy;
            rot = mdVSVertex.rot;
          }

          const zoom2V = zoom ** (zoomExp ** (rad * 2.0 - 1.0));
          const zoom2Inv = 1.0 / zoom2V;

          let u = x * 0.5 * aspectx * zoom2Inv + 0.5;
          let v = -y * 0.5 * aspecty * zoom2Inv + 0.5;

          u = (u - cx) / sx + cx;
          v = (v - cy) / sy + cy;

          if (warp !== 0) {
            u +=
              warp *
              0.0035 *
              Math.sin(
                warpTimeV * 0.333 + warpScaleInv * (x * warpf0 - y * warpf3)
              );
            v +=
              warp *
              0.0035 *
              Math.cos(
                warpTimeV * 0.375 - warpScaleInv * (x * warpf2 + y * warpf1)
              );
            u +=
              warp *
              0.0035 *
              Math.cos(
                warpTimeV * 0.753 - warpScaleInv * (x * warpf1 - y * warpf2)
              );
            v +=
              warp *
              0.0035 *
              Math.sin(
                warpTimeV * 0.825 + warpScaleInv * (x * warpf0 + y * warpf3)
              );
          }

          const u2 = u - cx;
          const v2 = v - cy;

          const cosRot = Math.cos(rot);
          const sinRot = Math.sin(rot);
          u = u2 * cosRot - v2 * sinRot + cx;
          v = u2 * sinRot + v2 * cosRot + cy;

          u -= dx;
          v -= dy;

          u = (u - 0.5) / aspectx + 0.5;
          v = (v - 0.5) / aspecty + 0.5;

          u += texelOffsetX;
          v += texelOffsetY;

          if (!blending) {
            this.warpUVs[offset] = u;
            this.warpUVs[offset + 1] = v;

            this.warpColor[offsetColor + 0] = 1;
            this.warpColor[offsetColor + 1] = 1;
            this.warpColor[offsetColor + 2] = 1;
            this.warpColor[offsetColor + 3] = 1;
          } else {
            let mix2 =
              this.blendPattern.vertInfoA[offset / 2] * this.blendProgress +
              this.blendPattern.vertInfoC[offset / 2];
            mix2 = Math.clamp(mix2, 0, 1);

            this.warpUVs[offset] = this.warpUVs[offset] * mix2 + u * (1 - mix2);
            this.warpUVs[offset + 1] =
              this.warpUVs[offset + 1] * mix2 + v * (1 - mix2);

            this.warpColor[offsetColor + 0] = 1;
            this.warpColor[offsetColor + 1] = 1;
            this.warpColor[offsetColor + 2] = 1;
            this.warpColor[offsetColor + 3] = mix2;
          }

          offset += 2;
          offsetColor += 4;
        }
      }

      this.mdVSVertex = mdVSVertex;
    } else {
      const varPool = presetEquationRunner.preset.globalPools.perVertex;

      Utils.setWasm(varPool, globalVars, presetEquationRunner.globalKeys);
      Utils.setWasm(
        varPool,
        presetEquationRunner.mdVSQAfterFrame,
        presetEquationRunner.qs
      );

      varPool.zoom.value = mdVSFrame.zoom;
      varPool.zoomexp.value = mdVSFrame.zoomexp;
      varPool.rot.value = mdVSFrame.rot;
      varPool.warp.value = mdVSFrame.warp;
      varPool.cx.value = mdVSFrame.cx;
      varPool.cy.value = mdVSFrame.cy;
      varPool.dx.value = mdVSFrame.dx;
      varPool.dy.value = mdVSFrame.dy;
      varPool.sx.value = mdVSFrame.sx;
      varPool.sy.value = mdVSFrame.sy;

      presetEquationRunner.preset.pixel_eqs_wasm(
        presetEquationRunner.runVertEQs,
        this.mesh_width,
        this.mesh_height,
        this.time,
        mdVSFrame.warpanimspeed,
        mdVSFrame.warpscale,
        this.aspectx,
        this.aspecty
      );

      if (!blending) {
        this.warpUVs = presetEquationRunner.preset.pixel_eqs_get_array();
        this.warpColor.fill(1);
      } else {
        const newWarpUVs = presetEquationRunner.preset.pixel_eqs_get_array();

        let offset = 0;
        let offsetColor = 0;
        for (let iz = 0; iz < gridZ1; iz++) {
          for (let ix = 0; ix < gridX1; ix++) {
            const u = newWarpUVs[offset];
            const v = newWarpUVs[offset + 1];

            let mix2 =
              this.blendPattern.vertInfoA[offset / 2] * this.blendProgress +
              this.blendPattern.vertInfoC[offset / 2];
            mix2 = Math.clamp(mix2, 0, 1);

            this.warpUVs[offset] = this.warpUVs[offset] * mix2 + u * (1 - mix2);
            this.warpUVs[offset + 1] =
              this.warpUVs[offset + 1] * mix2 + v * (1 - mix2);

            this.warpColor[offsetColor + 0] = 1;
            this.warpColor[offsetColor + 1] = 1;
            this.warpColor[offsetColor + 2] = 1;
            this.warpColor[offsetColor + 3] = mix2;

            offset += 2;
            offsetColor += 4;
          }
        }
      }
    }
  }

  static mixFrameEquations(blendProgress, mdVSFrame, mdVSFramePrev) {
    const mix = 0.5 - 0.5 * Math.cos(blendProgress * Math.PI);
    const mix2 = 1 - mix;
    const snapPoint = 0.5;

    const mixedFrame = Utils.cloneVars(mdVSFrame);

    mixedFrame.decay = mix * mdVSFrame.decay + mix2 * mdVSFramePrev.decay;
    mixedFrame.wave_a = mix * mdVSFrame.wave_a + mix2 * mdVSFramePrev.wave_a;
    mixedFrame.wave_r = mix * mdVSFrame.wave_r + mix2 * mdVSFramePrev.wave_r;
    mixedFrame.wave_g = mix * mdVSFrame.wave_g + mix2 * mdVSFramePrev.wave_g;
    mixedFrame.wave_b = mix * mdVSFrame.wave_b + mix2 * mdVSFramePrev.wave_b;
    mixedFrame.wave_x = mix * mdVSFrame.wave_x + mix2 * mdVSFramePrev.wave_x;
    mixedFrame.wave_y = mix * mdVSFrame.wave_y + mix2 * mdVSFramePrev.wave_y;
    mixedFrame.wave_mystery =
      mix * mdVSFrame.wave_mystery + mix2 * mdVSFramePrev.wave_mystery;
    mixedFrame.ob_size = mix * mdVSFrame.ob_size + mix2 * mdVSFramePrev.ob_size;
    mixedFrame.ob_r = mix * mdVSFrame.ob_r + mix2 * mdVSFramePrev.ob_r;
    mixedFrame.ob_g = mix * mdVSFrame.ob_g + mix2 * mdVSFramePrev.ob_g;
    mixedFrame.ob_b = mix * mdVSFrame.ob_b + mix2 * mdVSFramePrev.ob_b;
    mixedFrame.ob_a = mix * mdVSFrame.ob_a + mix2 * mdVSFramePrev.ob_a;
    mixedFrame.ib_size = mix * mdVSFrame.ib_size + mix2 * mdVSFramePrev.ib_size;
    mixedFrame.ib_r = mix * mdVSFrame.ib_r + mix2 * mdVSFramePrev.ib_r;
    mixedFrame.ib_g = mix * mdVSFrame.ib_g + mix2 * mdVSFramePrev.ib_g;
    mixedFrame.ib_b = mix * mdVSFrame.ib_b + mix2 * mdVSFramePrev.ib_b;
    mixedFrame.ib_a = mix * mdVSFrame.ib_a + mix2 * mdVSFramePrev.ib_a;
    mixedFrame.mv_x = mix * mdVSFrame.mv_x + mix2 * mdVSFramePrev.mv_x;
    mixedFrame.mv_y = mix * mdVSFrame.mv_y + mix2 * mdVSFramePrev.mv_y;
    mixedFrame.mv_dx = mix * mdVSFrame.mv_dx + mix2 * mdVSFramePrev.mv_dx;
    mixedFrame.mv_dy = mix * mdVSFrame.mv_dy + mix2 * mdVSFramePrev.mv_dy;
    mixedFrame.mv_l = mix * mdVSFrame.mv_l + mix2 * mdVSFramePrev.mv_l;
    mixedFrame.mv_r = mix * mdVSFrame.mv_r + mix2 * mdVSFramePrev.mv_r;
    mixedFrame.mv_g = mix * mdVSFrame.mv_g + mix2 * mdVSFramePrev.mv_g;
    mixedFrame.mv_b = mix * mdVSFrame.mv_b + mix2 * mdVSFramePrev.mv_b;
    mixedFrame.mv_a = mix * mdVSFrame.mv_a + mix2 * mdVSFramePrev.mv_a;
    mixedFrame.echo_zoom =
      mix * mdVSFrame.echo_zoom + mix2 * mdVSFramePrev.echo_zoom;
    mixedFrame.echo_alpha =
      mix * mdVSFrame.echo_alpha + mix2 * mdVSFramePrev.echo_alpha;
    mixedFrame.echo_orient =
      mix * mdVSFrame.echo_orient + mix2 * mdVSFramePrev.echo_orient;
    mixedFrame.wave_dots =
      mix < snapPoint ? mdVSFramePrev.wave_dots : mdVSFrame.wave_dots;
    mixedFrame.wave_thick =
      mix < snapPoint ? mdVSFramePrev.wave_thick : mdVSFrame.wave_thick;
    mixedFrame.additivewave =
      mix < snapPoint ? mdVSFramePrev.additivewave : mdVSFrame.additivewave;
    mixedFrame.wave_brighten =
      mix < snapPoint ? mdVSFramePrev.wave_brighten : mdVSFrame.wave_brighten;
    mixedFrame.darken_center =
      mix < snapPoint ? mdVSFramePrev.darken_center : mdVSFrame.darken_center;
    mixedFrame.gammaadj =
      mix < snapPoint ? mdVSFramePrev.gammaadj : mdVSFrame.gammaadj;
    mixedFrame.wrap = mix < snapPoint ? mdVSFramePrev.wrap : mdVSFrame.wrap;
    mixedFrame.invert =
      mix < snapPoint ? mdVSFramePrev.invert : mdVSFrame.invert;
    mixedFrame.brighten =
      mix < snapPoint ? mdVSFramePrev.brighten : mdVSFrame.brighten;
    mixedFrame.darken =
      mix < snapPoint ? mdVSFramePrev.darken : mdVSFrame.darken;
    mixedFrame.solarize =
      mix < snapPoint ? mdVSFramePrev.brighten : mdVSFrame.solarize;
    mixedFrame.b1n = mix * mdVSFrame.b1n + mix2 * mdVSFramePrev.b1n;
    mixedFrame.b2n = mix * mdVSFrame.b2n + mix2 * mdVSFramePrev.b2n;
    mixedFrame.b3n = mix * mdVSFrame.b3n + mix2 * mdVSFramePrev.b3n;
    mixedFrame.b1x = mix * mdVSFrame.b1x + mix2 * mdVSFramePrev.b1x;
    mixedFrame.b2x = mix * mdVSFrame.b2x + mix2 * mdVSFramePrev.b2x;
    mixedFrame.b3x = mix * mdVSFrame.b3x + mix2 * mdVSFramePrev.b3x;
    mixedFrame.b1ed = mix * mdVSFrame.b1ed + mix2 * mdVSFramePrev.b1ed;

    return mixedFrame;
  }

  static getBlurValues(mdVSFrame) {
    let blurMin1 = mdVSFrame.b1n;
    let blurMin2 = mdVSFrame.b2n;
    let blurMin3 = mdVSFrame.b3n;
    let blurMax1 = mdVSFrame.b1x;
    let blurMax2 = mdVSFrame.b2x;
    let blurMax3 = mdVSFrame.b3x;

    const fMinDist = 0.1;
    if (blurMax1 - blurMin1 < fMinDist) {
      const avg = (blurMin1 + blurMax1) * 0.5;
      blurMin1 = avg - fMinDist * 0.5;
      blurMax1 = avg - fMinDist * 0.5;
    }
    blurMax2 = Math.min(blurMax1, blurMax2);
    blurMin2 = Math.max(blurMin1, blurMin2);
    if (blurMax2 - blurMin2 < fMinDist) {
      const avg = (blurMin2 + blurMax2) * 0.5;
      blurMin2 = avg - fMinDist * 0.5;
      blurMax2 = avg - fMinDist * 0.5;
    }
    blurMax3 = Math.min(blurMax2, blurMax3);
    blurMin3 = Math.max(blurMin2, blurMin3);
    if (blurMax3 - blurMin3 < fMinDist) {
      const avg = (blurMin3 + blurMax3) * 0.5;
      blurMin3 = avg - fMinDist * 0.5;
      blurMax3 = avg - fMinDist * 0.5;
    }

    return {
      blurMins: [blurMin1, blurMin2, blurMin3],
      blurMaxs: [blurMax1, blurMax2, blurMax3],
    };
  }

  bindFrambufferAndSetViewport(fb, width, height) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
    this.gl.viewport(0, 0, width, height);
  }

  bindFrameBufferTexture(targetFrameBuffer, targetTexture) {
    this.gl.bindTexture(this.gl.TEXTURE_2D, targetTexture);

    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.texsizeX,
      this.texsizeY,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    // Skip mipmap generation for offscreen render targets

    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR
    );
    if (this.anisoExt) {
      const max = this.gl.getParameter(
        this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT
      );
      this.gl.texParameterf(
        this.gl.TEXTURE_2D,
        this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        max
      );
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFrameBuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      targetTexture,
      0
    );
  }

  render({ audioLevels, elapsedTime } = {}) {
    this.calcTimeAndFPS(elapsedTime);
    this.frameNum += 1;

    if (audioLevels) {
      this.audio.updateAudio(
        audioLevels.timeByteArray,
        audioLevels.timeByteArrayL,
        audioLevels.timeByteArrayR
      );
    } else {
      this.audio.sampleAudio();
    }
    this.audioLevels.updateAudioLevels(this.fps, this.frameNum);

    // Update sync using mixed spectrum (mono)
    if (this.audio && this.audio.freqArray) {
      const dt = elapsedTime || 1 / Math.max(24, Math.round(this.fps) || 30);
      const spec = this.audio.freqArrayL || this.audio.freqArray || null;
      if (this.syncEngine && spec) {
        // Provide band ranges to BeatSync once
        if (!this._beatBandsSet) {
          const sampleRate = this.audio.audioContext ? this.audio.audioContext.sampleRate : 44100;
          const bucketHz = sampleRate / this.audio.fftSize;
          const bassLow = Math.max(0, Math.round(20 / bucketHz) - 1);
          const bassHigh = Math.max(0, Math.round(320 / bucketHz) - 1);
          const midHigh = Math.max(0, Math.round(2800 / bucketHz) - 1);
          const trebHigh = Math.max(0, Math.round(11025 / bucketHz) - 1);
          this.syncEngine.setBands([
            { start: bassLow, stop: bassHigh },
            { start: bassHigh, stop: midHigh },
            { start: midHigh, stop: trebHigh },
          ]);
          this._beatBandsSet = true;
        }
        const sr = this.audio.audioContext ? this.audio.audioContext.sampleRate : 44100;
        const engineState = this.syncEngine.update(dt, spec, sr, this.audio.fftSize);
        if (engineState) {
          this.beatState = engineState; // maintain existing naming, but contains unified fields
        }
      }
    }

    // If a preset change is queued for downbeat, trigger exactly on bar boundary
    if (this.quantizeTransitions && this.pendingPreset && this.beatState) {
      const shouldTrigger = this.beatState.onDownbeat &&
        ((this.beatState.barCount % Math.max(1, this.quantizeBars)) === 0) &&
        (this._lastBarForQuant !== this.beatState.barCount);
      if (shouldTrigger) {
        const { preset: _qpreset, blendTime: _qblend } = this.pendingPreset;
        this.pendingPreset = null;
        this._loadingImmediate = true;
        this.loadPreset(_qpreset, _qblend);
        this._loadingImmediate = false;
        this._lastBarForQuant = this.beatState.barCount;
      }
    }

    const globalVars = {
      frame: this.frameNum,
      time: this.time,
      fps: this.fps,
      bass: this.audioLevels.bass,
      bass_att: this.audioLevels.bass_att,
      mid: this.audioLevels.mid,
      mid_att: this.audioLevels.mid_att,
      treb: this.audioLevels.treb,
      treb_att: this.audioLevels.treb_att,
      meshx: this.mesh_width,
      meshy: this.mesh_height,
      aspectx: this.invAspectx,
      aspecty: this.invAspecty,
      pixelsx: this.texsizeX,
      pixelsy: this.texsizeY,
    };

    const prevGlobalVars = Object.assign({}, globalVars);
    if (!this.prevPreset.useWASM) {
      prevGlobalVars.gmegabuf = this.prevPresetEquationRunner.gmegabuf;
    }

    if (!this.preset.useWASM) {
      globalVars.gmegabuf = this.presetEquationRunner.gmegabuf;
      Object.assign(globalVars, this.regVars);
    }

    // Provide beat info and features to preset globals for equations
    if (!globalVars.gmegabuf) globalVars.gmegabuf = this.presetEquationRunner.gmegabuf || {};
    if (this.beatState) {
      globalVars.beat_phase = this.beatState.phase;
      globalVars.bar_phase = this.beatState.barPhase;
      globalVars.onbeat = this.beatState.onBeat ? 1 : 0;
      globalVars.on_downbeat = this.beatState.onDownbeat ? 1 : 0;
      globalVars.bpm = this.beatState.bpm;
      globalVars.beat_conf = this.beatState.confidence;
      globalVars.flux = this.beatState.flux || 0;
      globalVars.on_bass = this.beatState.onBass ? 1 : 0;
      globalVars.on_mid = this.beatState.onMid ? 1 : 0;
      globalVars.on_treb = this.beatState.onTreb ? 1 : 0;
    } else {
      globalVars.beat_phase = 0;
      globalVars.bar_phase = 0;
      globalVars.onbeat = 0;
      globalVars.on_downbeat = 0;
      globalVars.bpm = 120;
      globalVars.beat_conf = 0;
      globalVars.flux = 0;
      globalVars.on_bass = 0;
      globalVars.on_mid = 0;
      globalVars.on_treb = 0;
    }

    // Provide unified moment globals
    const bs = this.beatState;
    globalVars.moment_bar_phase = bs ? (bs.momentBarPhase || 0) : 0;
    globalVars.moment_phrase_phase = bs ? (bs.phrasePhase || 0) : 0;
    globalVars.moment_cinematic_phase = bs ? (bs.cinematicPhase || 0) : 0;
    globalVars.moment_4_phase = bs ? (bs.div4Phase || 0) : 0;
    globalVars.moment_8_phase = bs ? (bs.div8Phase || 0) : 0;
    globalVars.moment_16_phase = bs ? (bs.div16Phase || 0) : 0;
    globalVars.on_moment_4 = bs && bs.on_div4 ? 1 : 0;
    globalVars.on_moment_8 = bs && bs.on_div8 ? 1 : 0;
    globalVars.on_moment_16 = bs && bs.on_div16 ? 1 : 0;

    const mdVSFrame = this.presetEquationRunner.runFrameEquations(globalVars);

    this.runPixelEquations(
      this.presetEquationRunner,
      mdVSFrame,
      globalVars,
      false
    );

    if (!this.preset.useWASM) {
      Object.assign(this.regVars, Utils.pick(this.mdVSVertex, this.regs));
      Object.assign(globalVars, this.regVars);
    }

    let mdVSFrameMixed;
    if (this.blending) {
      this.prevMDVSFrame = this.prevPresetEquationRunner.runFrameEquations(
        prevGlobalVars
      );
      this.runPixelEquations(
        this.prevPresetEquationRunner,
        this.prevMDVSFrame,
        prevGlobalVars,
        true
      );

      mdVSFrameMixed = Renderer.mixFrameEquations(
        this.blendProgress,
        mdVSFrame,
        this.prevMDVSFrame
      );
    } else {
      mdVSFrameMixed = mdVSFrame;
    }

    const swapTexture = this.targetTexture;
    this.targetTexture = this.prevTexture;
    this.prevTexture = swapTexture;

    const swapFrameBuffer = this.targetFrameBuffer;
    this.targetFrameBuffer = this.prevFrameBuffer;
    this.prevFrameBuffer = swapFrameBuffer;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.prevTexture);
    // No mipmap generation needed for post-process pass

    this.bindFrambufferAndSetViewport(
      this.targetFrameBuffer,
      this.texsizeX,
      this.texsizeY
    );

    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendEquation(this.gl.FUNC_ADD);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    const { blurMins, blurMaxs } = Renderer.getBlurValues(mdVSFrameMixed);

    if (!this.blending) {
      this.warpShader.renderQuadTexture(
        false,
        this.prevTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        mdVSFrame,
        this.presetEquationRunner.mdVSQAfterFrame,
        this.warpUVs,
        this.warpColor
      );
    } else {
      this.prevWarpShader.renderQuadTexture(
        false,
        this.prevTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        this.prevMDVSFrame,
        this.prevPresetEquationRunner.mdVSQAfterFrame,
        this.warpUVs,
        this.warpColor
      );

      this.warpShader.renderQuadTexture(
        true,
        this.prevTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        mdVSFrameMixed,
        this.presetEquationRunner.mdVSQAfterFrame,
        this.warpUVs,
        this.warpColor
      );
    }

    if (this.numBlurPasses > 0) {
      const bloomBoost = (this.fxGate.bloom && this.beatState?.onBass) ? Math.min(1.0, Math.max(0.0, 0.85 * (this.beatState.confidence || 0))) : 0.0;
      const blurBoost1 = 0.12 * bloomBoost;
      const blurBoost2 = 0.08 * bloomBoost;
      const blurBoost3 = 0.04 * bloomBoost;
      // Temporarily bias blur ranges for this frame on bass onsets
      const blurMinsBoosted = [
        Math.max(0, blurMins[0] - blurBoost1),
        Math.max(0, blurMins[1] - blurBoost2),
        Math.max(0, blurMins[2] - blurBoost3),
      ];
      const blurMaxsBoosted = [
        Math.min(1, blurMaxs[0] + blurBoost1),
        Math.min(1, blurMaxs[1] + blurBoost2),
        Math.min(1, blurMaxs[2] + blurBoost3),
      ];
      this.blurShader1.renderBlurTexture(
        this.targetTexture,
        mdVSFrame,
        bloomBoost > 0 ? blurMinsBoosted : blurMins,
        bloomBoost > 0 ? blurMaxsBoosted : blurMaxs
      );

      if (this.numBlurPasses > 1) {
        this.blurShader2.renderBlurTexture(
          this.blurTexture1,
          mdVSFrame,
          bloomBoost > 0 ? blurMinsBoosted : blurMins,
          bloomBoost > 0 ? blurMaxsBoosted : blurMaxs
        );

        if (this.numBlurPasses > 2) {
          this.blurShader3.renderBlurTexture(
            this.blurTexture2,
            mdVSFrame,
            bloomBoost > 0 ? blurMinsBoosted : blurMins,
            bloomBoost > 0 ? blurMaxsBoosted : blurMaxs
          );
        }
      }

      // rebind target texture framebuffer
      this.bindFrambufferAndSetViewport(
        this.targetFrameBuffer,
        this.texsizeX,
        this.texsizeY
      );
    }

    // Model-based effects: audio-reactive params + transitions
    const dt = elapsedTime || 1 / Math.max(24, Math.round(this.fps) || 30);
    const energy = Math.max(0, Math.min(1,
      0.6 * this.audioLevels.bass_att + 0.3 * this.audioLevels.mid_att + 0.1 * this.audioLevels.treb_att
    ));

    if (this.modelEffectsEnabled) {
      // Update dynamic params from audio
      const scale = this.modelBase.scale * (1.0 + 0.2 * energy);
      const pointSize = this.modelBase.pointSize * (0.95 + 0.35 * energy);
      const spinSpeed = this.modelBase.spinSpeed * (0.7 + 0.9 * energy);
      this.particleModel.scale = scale;
      this.particleModel.pointSize = pointSize;
      this.particleModel.spinSpeed = spinSpeed;
      // Cinematic camera dolly (subtle)
      // Beat/shot detection with tighter smoothing and thresholding
      const eAlpha = Math.max(0, Math.min(1, this.stab.energyEMAAlpha));
      this.energyEMA = (1 - eAlpha) * this.energyEMA + eAlpha * energy;
      const energyDelta = energy - this.energyEMA;
      const now = this.time;
      const canTrigger = (now - this.lastShotTime) > (this.stab.cameraCooldown || 1.6);
      const conf = (this.beatState?.confidence || 0);
      const beatHit = this.beatState?.onBeat && conf > this.stab.confThreshold;
      if (this.fxGate?.cameraShots !== false && (energyDelta > 0.22 || beatHit) && canTrigger) {
        this._startCameraShot(energy);
        this.lastShotTime = now;
      }

      // Base cinematic camera (idle dolly)
      // Face-level cinematic framing
      const framing = this.particleModel.getFramingInfo();
      const faceY = framing.faceY || 0.5;
      // Decay event router states
      const conf2 = Math.max(0, Math.min(1, this.beatState?.confidence || 0));
      const dec = this.stab.nudgeDecay;
      this._camNudgeZ *= dec.z; this._camNudgeSide *= dec.side; this._fovNarrow *= dec.fov; this._particlesBurst *= dec.particles; this._grainSpark *= dec.grain;
      // Gate reactivity on moment divisions to reduce jitter
      const gateDiv = this.stab.eventGateDivision;
      const onGate = gateDiv === 16 ? (this.momentState?.divisions?.[16]?.on) : (gateDiv === 4 ? (this.momentState?.divisions?.[4]?.on) : (this.momentState?.divisions?.[8]?.on));
      if (onGate && conf2 > this.stab.confThreshold) {
        if (this.fxGate?.bassShake !== false && this.beatState?.onBass) { this._camNudgeZ += 0.7 * conf2; this._fovNarrow += 0.45 * conf2; this._camNudgeSide += 0.18 * conf2; }
        if (this.beatState?.onMid) { this._particlesBurst += 0.7 * conf2; }
        if (this.beatState?.onTreb) { this._grainSpark += 0.55 * conf2; }
      }

      const baseEyeZ = 2.4 - 0.35 * energy - 0.20 * this._camNudgeZ; // closer for portrait, bass punch-in
      const baseEyeY = faceY + 0.06 + 0.08 * Math.sin(this.time * 0.45);
      let eye = [0.0, baseEyeY, baseEyeZ];
      // Slightly wider angle on wide screens to fill frame
      const aspect = this.width / this.height;
      let fov = (aspect >= 1.7 ? 46 : 50) * Math.PI / 180;
      fov *= (1.0 - 0.10 * Math.min(1.0, this._fovNarrow));

      // Apply active shot blending
      if (this.cameraShotActive) {
        this.cameraShotT += dt / this.cameraShotDuration;
        if (this.cameraShotT >= 1.0) {
          this.cameraShotT = 1.0;
          this.cameraShotActive = false;
        }
        const t = this._easeInOutCubic(this.cameraShotT);
        eye = [
          this._mix(this.cameraShotFrom.eye[0], this.cameraShotTo.eye[0], t),
          this._mix(this.cameraShotFrom.eye[1], this.cameraShotTo.eye[1], t),
          this._mix(this.cameraShotFrom.eye[2], this.cameraShotTo.eye[2], t),
        ];
        fov = this._mix(this.cameraShotFrom.fov, this.cameraShotTo.fov, t);
      }

      // Slight side dolly for shot variety
      const beatWobble = this.beatState ? (0.05 * Math.sin(this.beatState.phase * Math.PI * 2)) : 0.0;
      const baseWobble = (this.fxGate?.bassShake === false) ? 0.0 : this.stab.sideWobble;
      const side = baseWobble * Math.sin(this.time * 0.35) + beatWobble + 0.05 * this._camNudgeSide;
      this.particleModel.setCamera({ eye: [side, eye[1], eye[2]], target: [0, faceY, 0], fov, aspect });
      this.particles.configure({ pointSize: Math.max(2.0, 5.0 * (energy + 0.25 * this._particlesBurst)), speed: 1.0 + energy + 0.6 * this._particlesBurst });

      // Transition mix between previous and current models
      let alphaCur = 1.0;
      let alphaPrev = 0.0;
      if (this.modelTransitionActive) {
        this.modelBlendProgress += dt / this.modelBlendTime;
        if (this.modelBlendProgress >= 1.0) {
          this.modelBlendProgress = 1.0;
          this.modelTransitionActive = false;
          this.particleModelPrev.setEnabled(false);
        }
        alphaCur = this.modelBlendProgress;
        alphaPrev = 1.0 - this.modelBlendProgress;
      }

      // Draw as overlay
      this.particles.drawParticles(dt, this.audioLevels);
      this.particleModelPrev.draw(dt, alphaPrev);
      this.particleModel.draw(dt, alphaCur);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Still allow ambiance particles if enabled
      this.particles.drawParticles(dt, this.audioLevels);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    // Beat-driven PostFX modulation (subtle, cinematic)
    if (this.beatState) {
      const conf = Math.max(0, Math.min(1, this.beatState.confidence || 0));
      const onset = Math.max(0, Math.min(1, this.beatState.onsetStrength || 0));
      const bandS = this.beatState.bandStrengths || [0,0,0];
      const scale = this.stab.postFXImpactScale || 0.7;
      // Pulses: make visuals feel like dancing to music
      const onBeatPulse = ((this.beatState.onBeat ? 0.10 : 0.0) * conf + 0.06 * onset) * scale;
      const beatSwell = (0.045 * Math.sin(this.beatState.phase * Math.PI * 2)) * scale;
      const bassPunch = ((0.03 + 0.05 * bandS[0]) * conf) * scale;
      const trebCrackle = ((0.012 + 0.02 * bandS[2]) * conf) * scale;
      const downbeatBounce = ((this.beatState.onDownbeat ? (0.18 + 0.22 * conf) : 0.0)) * scale;

      const targetFX = {
        exposure: this.postFX.exposure + onBeatPulse + beatSwell,
        contrast: this.postFX.contrast + bassPunch,
        grain: Math.max(0, this.postFX.grain + trebCrackle),
        bassShake: (this.fxGate?.bassShake === false) ? 0 : Math.min(1.0, Math.max(0.0, (this.beatState.onBass ? 0.65 : 0.0) * conf)),
        zoomBounce: (this.fxGate?.zoomBounce === false) ? 0 : Math.min(1.0, Math.max(0.0, downbeatBounce)),
      };
      // smooth towards target to avoid stepping
      const lerp = (a, b, t) => a * (1 - t) + b * t;
      const t = Math.max(0, Math.min(1, this.stab.postFXLerp));
      this.postFX.exposure = lerp(this.postFX.exposure, targetFX.exposure, t);
      this.postFX.contrast = lerp(this.postFX.contrast, targetFX.contrast, t);
      this.postFX.grain = lerp(this.postFX.grain, targetFX.grain, t);
      this.postFX.bassShake = lerp(this.postFX.bassShake, targetFX.bassShake, 0.22);
      this.postFX.zoomBounce = lerp(this.postFX.zoomBounce, targetFX.zoomBounce, 0.22);
    }

    if (this.preset.shapes && this.preset.shapes.length > 0) {
      this.customShapes.forEach((shape, i) => {
        shape.drawCustomShape(
          this.blending ? this.blendProgress : 1,
          globalVars,
          this.presetEquationRunner,
          this.preset.shapes[i],
          this.prevTexture
        );
      });
    }

    if (this.preset.waves && this.preset.waves.length > 0) {
      this.customWaveforms.forEach((waveform, i) => {
        waveform.drawCustomWaveform(
          this.blending ? this.blendProgress : 1,
          this.audio.timeArrayL,
          this.audio.timeArrayR,
          this.audio.freqArrayL,
          this.audio.freqArrayR,
          globalVars,
          this.presetEquationRunner,
          this.preset.waves[i]
        );
      });
    }

    // Auto vibe cycle on phrase boundary
    if (this.autoVibes && this.beatState) {
      if (this._lastBarCount == null) this._lastBarCount = this.beatState.barCount;
      if (this.beatState.barCount !== this._lastBarCount && (this.beatState.barCount % this.barsPerVibe) === 0) {
        this.cycleVibes(1);
      }
      this._lastBarCount = this.beatState.barCount;
    }

    if (this.blending) {
      if (this.prevPreset.shapes && this.prevPreset.shapes.length > 0) {
        this.prevCustomShapes.forEach((shape, i) => {
          shape.drawCustomShape(
            1.0 - this.blendProgress,
            prevGlobalVars,
            this.prevPresetEquationRunner,
            this.prevPreset.shapes[i],
            this.prevTexture
          );
        });
      }

      if (this.prevPreset.waves && this.prevPreset.waves.length > 0) {
        this.prevCustomWaveforms.forEach((waveform, i) => {
          waveform.drawCustomWaveform(
            1.0 - this.blendProgress,
            this.audio.timeArrayL,
            this.audio.timeArrayR,
            this.audio.freqArrayL,
            this.audio.freqArrayR,
            prevGlobalVars,
            this.prevPresetEquationRunner,
            this.prevPreset.waves[i]
          );
        });
      }
    }

    this.basicWaveform.drawBasicWaveform(
      this.blending,
      this.blendProgress,
      this.audio.timeArrayL,
      this.audio.timeArrayR,
      mdVSFrameMixed
    );

    this.darkenCenter.drawDarkenCenter(mdVSFrameMixed);

    const outerColor = [
      mdVSFrameMixed.ob_r,
      mdVSFrameMixed.ob_g,
      mdVSFrameMixed.ob_b,
      mdVSFrameMixed.ob_a,
    ];
    this.outerBorder.drawBorder(outerColor, mdVSFrameMixed.ob_size, 0);

    const innerColor = [
      mdVSFrameMixed.ib_r,
      mdVSFrameMixed.ib_g,
      mdVSFrameMixed.ib_b,
      mdVSFrameMixed.ib_a,
    ];
    this.innerBorder.drawBorder(
      innerColor,
      mdVSFrameMixed.ib_size,
      mdVSFrameMixed.ob_size
    );

    if (this.supertext.startTime >= 0) {
      const progress =
        (this.time - this.supertext.startTime) / this.supertext.duration;
      if (progress >= 1) {
        this.titleText.renderTitle(progress, true, globalVars);
      }
    }

    // Store variables in case we need to rerender
    this.globalVars = globalVars;
    this.mdVSFrame = mdVSFrame;
    this.mdVSFrameMixed = mdVSFrameMixed;

    this.renderToScreen();
  }

  renderToScreen() {
    // If model-only mode is enabled and we have a model loaded, bypass comp pass and output current framebuffer
    const modelLoaded = this.particleModel && this.particleModel.count > 0;
    if (this.modelOnly && this.modelEffectsEnabled && modelLoaded) {
      this.bindFrambufferAndSetViewport(null, this.width, this.height);
      // Already drew into default framebuffer in render() before borders/text overlay
    } else if (this.outputFXAA) {
      this.bindFrambufferAndSetViewport(
        this.compFrameBuffer,
        this.texsizeX,
        this.texsizeY
      );
    } else {
      this.bindFrambufferAndSetViewport(null, this.width, this.height);
    }

    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendEquation(this.gl.FUNC_ADD);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    const { blurMins, blurMaxs } = Renderer.getBlurValues(this.mdVSFrameMixed);

    if (!this.blending) {
      this.compShader.renderQuadTexture(
        false,
        this.targetTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        this.mdVSFrame,
        this.presetEquationRunner.mdVSQAfterFrame,
        this.warpColor,
        this._applyDarkTheme(this.postFX)
      );
    } else {
      this.prevCompShader.renderQuadTexture(
        false,
        this.targetTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        this.prevMDVSFrame,
        this.prevPresetEquationRunner.mdVSQAfterFrame,
        this.warpColor,
        this._applyDarkTheme(this.postFX)
      );

      this.compShader.renderQuadTexture(
        true,
        this.targetTexture,
        this.blurTexture1,
        this.blurTexture2,
        this.blurTexture3,
        blurMins,
        blurMaxs,
        this.mdVSFrameMixed,
        this.presetEquationRunner.mdVSQAfterFrame,
        this.warpColor,
        this._applyDarkTheme(this.postFX)
      );
    }

    if (this.supertext.startTime >= 0) {
      const progress =
        (this.time - this.supertext.startTime) / this.supertext.duration;
      this.titleText.renderTitle(progress, false, this.globalVars);

      if (progress >= 1) {
        this.supertext.startTime = -1;
      }
    }

    if (this.outputFXAA) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.compTexture);
      this.gl.generateMipmap(this.gl.TEXTURE_2D);

      this.bindFrambufferAndSetViewport(null, this.width, this.height);
      this.outputShader.renderQuadTexture(this.compTexture);
    }
  }

  // Clamp/guide postFX toward dark theme if enabled
  _applyDarkTheme(src) {
    if (!this.darkTheme || !this.darkTheme.enabled) return src;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const dst = Object.assign({}, src);
    dst.exposure = clamp(dst.exposure, this.darkTheme.minExposure, this.darkTheme.maxExposure);
    dst.saturation = clamp(dst.saturation, this.darkTheme.minSaturation, this.darkTheme.maxSaturation);
    dst.tonemap = Math.max(this.darkTheme.tonemapMin, dst.tonemap || 0);
    dst.vignette = Math.max(this.darkTheme.vignetteMin, dst.vignette || 0);
    // Lerp tint a bit toward base dark palette
    const t = this.darkTheme.tintLerp;
    dst.tint = [
      (1 - t) * dst.tint[0] + t * this.darkTheme.baseTint[0],
      (1 - t) * dst.tint[1] + t * this.darkTheme.baseTint[1],
      (1 - t) * dst.tint[2] + t * this.darkTheme.baseTint[2],
    ];
    return dst;
  }

  // Public controls for model effects
  setModelEffectsEnabled(enabled) {
    this.modelEffectsEnabled = !!enabled;
    this.particleModel.setEnabled(!!enabled);
  }

  setModelOnlyMode(enabled) {
    this.modelOnly = !!enabled;
  }

  setModelBaseParams(params = {}) {
    this.modelBase = Object.assign({}, this.modelBase, params);
  }

  async loadModelWithTransition(url, opts = {}) {
    // Move current to prev
    if (this.particleModel && this.particleModel.count > 0) {
      // swap buffers by reusing data via toString is pricey; just keep prev as copy of current buffer if needed
      this.particleModelPrev = this.particleModelPrev || new ParticleModel(this.gl, {});
      // We can't clone GL buffer easily; instead, swap references
      const tmp = this.particleModelPrev;
      this.particleModelPrev = this.particleModel;
      this.particleModel = tmp;
    }
    // Load new into current
    await this.particleModel.loadOBJFromURL(url, opts.sampleEvery || 4);
    this.particleModel.setEnabled(true);
    if (opts.configure) this.particleModel.configure(opts.configure);
    // Start transition
    this.modelBlendProgress = 0.0;
    this.modelBlendTime = opts.blendTime || 1.2;
    this.modelTransitionActive = true;
    this.modelEffectsEnabled = true;
  }

  launchSongTitleAnim(text) {
    this.supertext = {
      startTime: this.time,
      duration: 1.7,
    };
    this.titleText.generateTitleTexture(text);
  }

  toDataURL() {
    const data = new Uint8Array(this.texsizeX * this.texsizeY * 4);

    const compFrameBuffer = this.gl.createFramebuffer();
    const compTexture = this.gl.createTexture();

    this.bindFrameBufferTexture(compFrameBuffer, compTexture);

    const { blurMins, blurMaxs } = Renderer.getBlurValues(this.mdVSFrameMixed);
    this.compShader.renderQuadTexture(
      false,
      this.targetTexture,
      this.blurTexture1,
      this.blurTexture2,
      this.blurTexture3,
      blurMins,
      blurMaxs,
      this.mdVSFrame,
      this.presetEquationRunner.mdVSQAfterFrame,
      this.warpColor,
      this.postFX
    );

    this.gl.readPixels(
      0,
      0,
      this.texsizeX,
      this.texsizeY,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data
    );

    // flip data
    Array.from({ length: this.texsizeY }, (val, i) =>
      data.slice(i * this.texsizeX * 4, (i + 1) * this.texsizeX * 4)
    ).forEach((val, i) =>
      data.set(val, (this.texsizeY - i - 1) * this.texsizeX * 4)
    );

    const canvas = document.createElement("canvas");
    canvas.width = this.texsizeX;
    canvas.height = this.texsizeY;

    const context = canvas.getContext("2d", { willReadFrequently: false });
    const imageData = context.createImageData(this.texsizeX, this.texsizeY);
    imageData.data.set(data);
    context.putImageData(imageData, 0, 0);

    this.gl.deleteTexture(compTexture);
    this.gl.deleteFramebuffer(compFrameBuffer);

    return canvas.toDataURL();
  }

  // Update cinematic post-processing parameters
  setPostFX(partial = {}) {
    this.postFX = Object.assign({}, this.postFX, partial);
  }

  // Artistic scene helpers
  applySceneWater() {
    this.setModelEffectsEnabled(false);
    this.setPostFX({ tonemap: 0.9, exposure: 0.05, saturation: -0.05, tint: [0.92, 1.05, 1.08] });
  }

  // Realistic scenes support
  listScenes() { return listSceneDefs(); }
  async applyScene(keyOrIndex) {
    try {
      let scene = null;
      if (typeof keyOrIndex === 'string') {
        scene = Scenes.find((s) => s.key === keyOrIndex);
      } else if (typeof keyOrIndex === 'number') {
        const idx = Math.max(0, Math.min(Scenes.length - 1, keyOrIndex));
        scene = Scenes[idx];
      }
      if (!scene) return null;
      // vibe
      if (scene.vibeKey) this.applyVibe(scene.vibeKey);
      // post fx override
      if (scene.postFX) this.setPostFX(scene.postFX);
      // model params
      if (scene.modelParams) this.setModelBaseParams(scene.modelParams);
      // particles
      if (scene.particles) {
        this.setModelEffectsEnabled(!!scene.particles.enabled);
        if (scene.particles.enabled && this.configureParticles) this.configureParticles({ maxCount: scene.particles.maxCount || 800 });
      }
      // load model
      await this.loadModelWithTransition(scene.modelPath, { blendTime: 1.2, configure: scene.modelParams });
      // cinematic sync profile
      this.applySyncProfile('cinematic');
      return scene;
    } catch (_) { return null; }
  }

  applySceneBeach() {
    this.setModelEffectsEnabled(false);
    this.applyVibe('sunset_beach');
  }

  applySceneParty() {
    this.setModelEffectsEnabled(true);
    this.configureParticles?.({ maxCount: 1200 });
    this.setPostFX({ saturation: 0.25, contrast: 0.12, grain: 0.18, tint: [1.02, 1.0, 1.08] });
  }

  // Inject beat synchronizer
  setBeatSync(instance) {
    this.beatSync = instance || null;
  }

  // Inject moment synchronizer
  setMomentSync(instance) {
    this.momentSync = instance || null;
  }

  // Unified sync engine
  setSyncEngine(instance) {
    this.syncEngine = instance || null;
  }

  // Update moment synchronizer config
  setMomentConfig(cfg = {}) {
    if (this.momentSync && this.momentSync.setConfig) {
      this.momentSync.setConfig(cfg);
    }
  }

  // Enable cinematic, smooth, downbeat-quantized vibe with subtle blue-magenta tint
  enableCinematicMoments(options = {}) {
    const bars = options.barsPerTransition != null ? options.barsPerTransition : 2;
    const phraseBars = options.phraseBars != null ? options.phraseBars : 8;
    const swing = options.swing != null ? options.swing : 0.14;
    const latencySeconds = options.latencySeconds != null ? options.latencySeconds : -0.03;
    const smoothing = options.cinematicSmoothingPerSecond != null ? options.cinematicSmoothingPerSecond : 0.25;

    this.setQuantizedTransitions(true, bars);
    this.setMomentConfig({ phraseBars, swing, latencySeconds, cinematicSmoothingPerSecond: smoothing });
    // Gentle cool tint and mild contrast for calm tech vibe
    this.setPostFX({ tint: [0.94, 1.03, 1.08], contrast: 0.06, saturation: 0.06, vignette: Math.max(0.12, this.postFX.vignette || 0) });
  }

  // Preset sync profiles (expert tuned)
  applySyncProfile(name = "cinematic") {
    const n = String(name || '').toLowerCase();
    if (n === 'cinematic') {
      this.enableCinematicMoments({ barsPerTransition: 2, phraseBars: 8, swing: 0.12 });
      this.setMomentConfig({ groove: 'light_swing' });
      this.setStabilityConfig({ confThreshold: 0.6, eventGateDivision: 8, postFXImpactScale: 0.65, postFXLerp: 0.08, cameraCooldown: 1.8 });
      if (this.syncEngine && this.syncEngine.setConfig) this.syncEngine.setConfig({ confThreshold: 0.6, gateDivision: 8 });
    } else if (n === 'responsive') {
      // quicker, punchier
      this.setQuantizedTransitions(true, 1);
      this.setMomentConfig({ swing: 0.1, groove: 'heavy_swing', phraseBars: 4, latencySeconds: -0.02, cinematicSmoothingPerSecond: 0.35 });
      this.setStabilityConfig({ confThreshold: 0.5, eventGateDivision: 4, postFXImpactScale: 0.85, postFXLerp: 0.12, cameraCooldown: 1.2 });
      if (this.syncEngine && this.syncEngine.setConfig) this.syncEngine.setConfig({ confThreshold: 0.5, gateDivision: 4 });
    } else if (n === 'chill') {
      // very smooth, minimal movement
      this.setQuantizedTransitions(true, 4);
      this.setMomentConfig({ swing: 0.0, groove: 'straight', phraseBars: 16, latencySeconds: -0.03, cinematicSmoothingPerSecond: 0.18 });
      this.setStabilityConfig({ confThreshold: 0.7, eventGateDivision: 4, postFXImpactScale: 0.45, postFXLerp: 0.06, cameraCooldown: 2.2, sideWobble: 0.035 });
      if (this.syncEngine && this.syncEngine.setConfig) this.syncEngine.setConfig({ confThreshold: 0.7, gateDivision: 4 });
    }
    return n;
  }

  // Quantize preset transitions to downbeats (every N bars)
  setQuantizedTransitions(enabled = true, bars = 1) {
    this.quantizeTransitions = !!enabled;
    this.quantizeBars = Math.max(1, bars | 0);
  }

  // Enable synced transitions and auto-vibes by default for calmer visuals
  enableSyncedDefaults() {
    this.setQuantizedTransitions(true, 2);
    this.enableAutoVibes(true, 4);
  }

  // ---- Audio responsiveness controls ----
  setAudioResponse(cfg = {}) {
    if (this.audioLevels && this.audioLevels.setResponse) {
      this.audioLevels.setResponse(cfg);
    }
  }

  // ---- Stability controls (public) ----
  setStabilityConfig(cfg = {}) {
    this.stab = Object.assign({}, this.stab, cfg);
  }

  setMicActive(active, micBoost = 1.6) {
    if (this.audioLevels && this.audioLevels.setResponse) {
      this.audioLevels.setResponse({ micActive: !!active, micBoost });
    }
  }

  setInputSensitivity(mult) {
    if (this.audio && this.audio.setSensitivity) {
      this.audio.setSensitivity(mult);
    }
  }

  setAnalyserSmoothing(value) {
    if (this.audio && this.audio.setAnalyserSmoothing) {
      this.audio.setAnalyserSmoothing(value);
    }
  }

  setTemporalSmoothing(value) {
    if (this.audio && this.audio.setTemporalSmoothing) {
      this.audio.setTemporalSmoothing(value);
    }
  }

  // Apply gentle PostFX styling hints from preset name keywords
  applyStyleFromName(name) {
    try {
      const n = String(name || '').toLowerCase();
      const fx = Object.assign({}, this.postFX);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

      const warm = () => { fx.tonemap = clamp((fx.tonemap || 0) + 0.6, 0, 1); fx.exposure = clamp((fx.exposure || 0) + 0.15, -1, 2); fx.tint = [1.06, 0.98, 0.92]; fx.vignette = clamp((fx.vignette || 0) + 0.12, 0, 0.5); fx.grain = clamp((fx.grain || 0) + 0.06, 0, 0.6); };
      const cool = () => { fx.tonemap = clamp((fx.tonemap || 0) + 0.5, 0, 1); fx.tint = [0.92, 1.05, 1.08]; fx.vignette = clamp((fx.vignette || 0) + 0.14, 0, 0.6); fx.grain = clamp((fx.grain || 0) + 0.1, 0, 0.7); };
      const storm = () => { fx.contrast = clamp((fx.contrast || 0) + 0.12, -0.5, 0.6); fx.bassShake = clamp((fx.bassShake || 0) + 0.5, 0, 1); fx.bassShakeFreq = 2.6; fx.bassShakeZoom = clamp((fx.bassShakeZoom || 0.05) + 0.02, 0, 0.15); };
      const fire  = () => { fx.saturation = clamp((fx.saturation || 0) + 0.25, -0.5, 0.6); fx.tint = [1.10, 0.94, 0.90]; };

      if (/(pearl|rose|mother)/.test(n)) warm();
      if (/(ghost|spirit|night)/.test(n)) cool();
      if (/(storm|hurricane|thunder|desert)/.test(n)) storm();
      if (/(fire|red|lava)/.test(n)) fire();

      this.setPostFX(fx);
    } catch (_) { /* no-op */ }
  }

  // Quick vibe controls
  applyVibe(keyOrIndex) {
    let idx = -1;
    if (typeof keyOrIndex === "number") {
      idx = Math.max(0, Math.min(this._vibes.length - 1, keyOrIndex));
    } else if (typeof keyOrIndex === "string") {
      idx = this._vibes.findIndex((v) => v.key === keyOrIndex);
      if (idx < 0) idx = 0;
    } else {
      idx = this._vibeIndex;
    }
    this._vibeIndex = idx;
    this.setPostFX(this._vibes[idx].postFX);
    return this._vibes[idx];
  }

  cycleVibes(step = 1) {
    this._vibeIndex = (this._vibeIndex + step + this._vibes.length) % this._vibes.length;
    this.setPostFX(this._vibes[this._vibeIndex].postFX);
    return this._vibes[this._vibeIndex];
  }

  getCurrentVibe() {
    return { index: this._vibeIndex, ...this._vibes[this._vibeIndex] };
  }

  warpBufferToDataURL() {
    const data = new Uint8Array(this.texsizeX * this.texsizeY * 4);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.targetFrameBuffer);
    this.gl.readPixels(
      0,
      0,
      this.texsizeX,
      this.texsizeY,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data
    );

    const canvas = document.createElement("canvas");
    canvas.width = this.texsizeX;
    canvas.height = this.texsizeY;

    const context = canvas.getContext("2d", { willReadFrequently: false });
    const imageData = context.createImageData(this.texsizeX, this.texsizeY);
    imageData.data.set(data);
    context.putImageData(imageData, 0, 0);

    return canvas.toDataURL();
  }
}
