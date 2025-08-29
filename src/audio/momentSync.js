export default class MomentSync {
  constructor(opts = {}) {
    // Divisions per bar to compute phases/edges for (e.g., [4, 8, 16])
    this.divisionsPerBar = Array.isArray(opts.divisionsPerBar) && opts.divisionsPerBar.length
      ? opts.divisionsPerBar.slice()
      : [4, 8, 16];

    // Swing amount for intra-beat warping (0..0.5 typical). 0 = straight, 0.15 = light swing
    this.swing = Math.max(0, Math.min(0.5, opts.swing || 0.14));

    // Phrase length in bars for long-form cinematic cycles
    this.phraseBars = Math.max(1, (opts.phraseBars | 0) || 8);

    // Latency compensation in seconds: negative means trigger a little earlier visually
    this.latencySeconds = Number.isFinite(opts.latencySeconds) ? opts.latencySeconds : -0.03;

    // Smoothing aggressiveness for cinematic phase; EMA alpha per second
    this.cinematicSmoothingPerSecond = Math.max(0, Math.min(1, opts.cinematicSmoothingPerSecond || 0.25));

    // Internal state
    this._lastIndex = new Map();
    this._phraseBaseBar = 0;
    this._cinPhase = 0;
    this._lastBarCount = 0;

    // Groove profile: adjusts intra-bar timing feel (0=straight, 1=heavy swing)
    // Provide simple presets: straight, light_swing, heavy_swing
    this.groove = (opts.groove || 'light_swing');
  }

  setConfig(opts = {}) {
    if (opts.divisionsPerBar && Array.isArray(opts.divisionsPerBar) && opts.divisionsPerBar.length) {
      this.divisionsPerBar = opts.divisionsPerBar.slice();
    }
    if (opts.swing != null) this.swing = Math.max(0, Math.min(0.5, opts.swing));
    if (opts.phraseBars != null) this.phraseBars = Math.max(1, opts.phraseBars | 0);
    if (Number.isFinite(opts.latencySeconds)) this.latencySeconds = opts.latencySeconds;
    if (Number.isFinite(opts.cinematicSmoothingPerSecond)) {
      this.cinematicSmoothingPerSecond = Math.max(0, Math.min(1, opts.cinematicSmoothingPerSecond));
    }
    if (opts.groove) this.groove = opts.groove;
  }

  // Warp phase inside a single beat for swing. Input and output in [0,1)
  _swingWarp(phase) {
    let s = this.swing;
    // Groove scaling
    if (this.groove === 'heavy_swing') s = Math.max(s, 0.2);
    else if (this.groove === 'light_swing') s = Math.max(s, 0.08);
    else if (this.groove === 'straight') s = 0;
    if (s <= 1e-6) return phase;
    // First half shortened by (1 - s), second half lengthened by (1 + s)
    const t1 = 0.5 * (1 - s);
    const t2 = 0.5 * (1 + s);
    if (phase < t1) {
      return (phase / t1) * 0.5;
    }
    const p = (phase - t1) / t2;
    return 0.5 + p * 0.5;
  }

  // Smooth circular value in [0,1)
  _circularEma(prev, current, alpha) {
    let delta = current - prev;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    let next = prev + alpha * delta;
    if (next >= 1) next -= 1;
    if (next < 0) next += 1;
    return next;
  }

  // dt: seconds since last update
  // beatState: state from BeatSync
  update(dt, beatState) {
    if (!beatState || !Number.isFinite(beatState.bpm) || beatState.bpm <= 0) {
      return null;
    }

    const meter = Math.max(1, beatState.meter || 4);
    const secondsPerBeat = Math.max(1e-3, beatState.period || (60 / beatState.bpm));
    const secondsPerBar = secondsPerBeat * meter;

    // Rebase phrase at bar reset or first call
    if (this._lastBarCount !== beatState.barCount && beatState.barCount === 0) {
      this._phraseBaseBar = 0;
    }

    // Compute bar-phase with swing and latency adjustment
    const beatsIntoBar = (beatState.beatCount % meter + meter) % meter;
    const swingPhase = this._swingWarp(beatState.phase || 0);
    let barPhase = (beatsIntoBar + swingPhase) / meter; // 0..1

    // Latency adjust in bar-time domain
    const barPhaseLatency = (this.latencySeconds / secondsPerBar);
    barPhase += barPhaseLatency;
    barPhase -= Math.floor(barPhase); // wrap 0..1

    // Phrase phase
    const barAbsolute = beatState.barCount + barPhase;
    const phrasePhase = ((barAbsolute - this._phraseBaseBar) / this.phraseBars) % 1;

    // Cinematic smoothed phase (wrap-aware)
    const alpha = 1 - Math.exp(-(this.cinematicSmoothingPerSecond || 0) * Math.max(0, dt || 0));
    this._cinPhase = this._circularEma(this._cinPhase || 0, barPhase, alpha);

    // Build per-division states
    const states = {};
    this.divisionsPerBar.forEach((div) => {
      const divInt = Math.max(1, div | 0);
      const idxFloat = (beatState.barCount * divInt) + (barPhase * divInt);
      const idx = Math.floor(idxFloat + 1e-6);
      const prevIdx = this._lastIndex.get(divInt) ?? idx;
      const on = idx !== prevIdx;
      if (on) this._lastIndex.set(divInt, idx);
      const phaseWithin = idxFloat - Math.floor(idxFloat);
      states[divInt] = { phase: phaseWithin, on };
    });

    this._lastBarCount = beatState.barCount;

    // Return a flat object for easy mapping
    return {
      swingPhase,
      barPhase: barPhase,
      phrasePhase: (phrasePhase + 1) % 1,
      cinematicPhase: this._cinPhase,
      divisions: states,
    };
  }
}


