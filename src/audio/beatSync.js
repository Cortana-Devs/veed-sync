export default class BeatSync {
  constructor(opts = {}) {
    this.expectedBpm = opts.expectedBpm || 120;
    this.meter = opts.meter || 4; // beats per bar
    this.maxHistory = 64;
    // Onset hysteresis reduces false triggers; min interval prevents doubles
    this.hysteresis = Math.max(1.0, opts.hysteresis || 1.04);
    this.minBeatInterval = Math.max(0.12, Math.min(0.5, opts.minBeatInterval || 0.18));
    this.reset();
    this.setConfig(opts);
    this.bandRanges = null; // [{start, stop}, ...]
    this.bandThresh = [ { mean:0, var:1 }, { mean:0, var:1 }, { mean:0, var:1 } ];
  }

  reset() {
    this.prevSpec = null;
    this.time = 0;
    this.beatCount = 0;
    this.barCount = 0;
    this.phase = 0; // 0..1 within current beat
    this.barPhase = 0; // 0..1 within current bar
    this.bpm = this.expectedBpm;
    this.period = 60 / this.bpm;
    this.onBeat = false;
    this.lastBeatTime = -1;
    this.ioiHistory = []; // inter-onset intervals
    this.confidence = 0;
    this.thresholdState = { mean: 0, var: 1 };
  }

  setConfig({ sensitivity, threshold, expectedBpm, meter } = {}) {
    // Sensitivity controls how much spectral flux must exceed its rolling mean
    this.sensitivity = Math.max(0.5, Math.min(3.0, sensitivity || 1.0));
    // Base threshold multiplier
    this.threshold = Math.max(0.5, Math.min(3.0, threshold || 1.0));
    if (expectedBpm) {
      this.expectedBpm = expectedBpm;
      this.bpm = expectedBpm;
      this.period = 60 / this.bpm;
    }
    if (meter) this.meter = meter;
  }

  setBands(ranges) {
    // ranges: array of {start, stop} index inclusive/exclusive
    if (Array.isArray(ranges) && ranges.length >= 3) {
      this.bandRanges = ranges.slice(0, 3).map((r) => ({ start: Math.max(0, r.start|0), stop: Math.max(0, r.stop|0) }));
    }
  }

  // dt: seconds between successive calls
  // spectrum: Float32Array of magnitudes (0..N-1), length stable across calls
  update(dt, spectrum) {
    this.onBeat = false;
    this.time += dt > 0 ? dt : 1 / 60;

    // Spectral flux (positive changes only)
    let flux = 0;
    const bandFlux = [0, 0, 0];
    if (this.prevSpec && spectrum && spectrum.length === this.prevSpec.length) {
      for (let i = 0; i < spectrum.length; i++) {
        const diff = spectrum[i] - this.prevSpec[i];
        if (diff > 0) flux += diff;
        if (diff > 0 && this.bandRanges) {
          for (let b = 0; b < 3; b++) {
            const r = this.bandRanges[b];
            if (i >= r.start && i < r.stop) bandFlux[b] += diff;
          }
        }
      }
    }
    this.prevSpec = spectrum ? spectrum.slice(0) : this.prevSpec;

    // Rolling stats for adaptive threshold
    const m = this.thresholdState;
    // Welford update for mean/variance (slowly varying)
    const alpha = 0.01; // slower baseline for calmer detection
    const delta = flux - m.mean;
    m.mean += alpha * delta;
    m.var = (1 - alpha) * (m.var + alpha * delta * delta);
    const std = Math.sqrt(Math.max(1e-6, m.var));

    const thresh = m.mean + this.sensitivity * this.threshold * (std + 0.002);
    const onsetStrength = Math.max(0, (flux - thresh) / (thresh + 1e-6));
    let isOnset = flux > (thresh * this.hysteresis);
    let bandOnsets = [false, false, false];
    if (this.bandRanges) {
      for (let b = 0; b < 3; b++) {
        const st = this.bandThresh[b];
        const a = 0.02;
        const d = bandFlux[b] - st.mean;
        st.mean += a * d;
        st.var = (1 - a) * (st.var + a * d * d);
        const s = Math.sqrt(Math.max(1e-6, st.var));
        const th = st.mean + this.sensitivity * this.threshold * s;
        bandOnsets[b] = bandFlux[b] > th;
      }
    }

    // Beat phase progression
    if (this.period <= 0.1 || this.period > 2.0) {
      this.period = 60 / Math.max(40, Math.min(200, this.bpm));
    }
    this.phase += dt / this.period;
    if (this.phase >= 1.0) this.phase -= Math.floor(this.phase);
    this.barPhase = ((this.beatCount % this.meter) + this.phase) / this.meter;

    // Onset handling and tempo tracking
    let onDownbeat = false;
    if (isOnset) {
      // Guard against double-triggering
      const sinceLast = this.lastBeatTime >= 0 ? (this.time - this.lastBeatTime) : Infinity;
      if (sinceLast < this.minBeatInterval) {
        isOnset = false;
      }
    }
    if (isOnset) {
      if (this.lastBeatTime >= 0) {
        const ioi = this.time - this.lastBeatTime;
        if (ioi > 0.18 && ioi < 1.5) { // ignore extreme outliers
          this.ioiHistory.push(ioi);
          if (this.ioiHistory.length > this.maxHistory) this.ioiHistory.shift();
          // Estimate tempo by median IOI
          const sorted = this.ioiHistory.slice().sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] || ioi;
          let estBpm = 60 / median;
          // Normalize to reasonable tempo range (factor of 2 ambiguity)
          while (estBpm < 60) estBpm *= 2;
          while (estBpm > 180) estBpm *= 0.5;
          // Smooth BPM changes (more conservative)
          this.bpm = 0.95 * this.bpm + 0.05 * estBpm;
          this.period = 60 / this.bpm;
          // Confidence rises with history and stability
          const spread = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)] || 0.001;
          const stability = Math.min(1, (median / Math.max(0.02, spread)) / 8);
          this.confidence = Math.min(1, 0.98 * this.confidence + 0.02 * stability);
        }
      }
      this.lastBeatTime = this.time;
      this.onBeat = true;
      // Snap phase on onset for tight sync
      this.phase = 0;
      this.beatCount += 1;
      onDownbeat = ((this.beatCount - 1) % this.meter) === 0;
      if (this.beatCount % this.meter === 0) this.barCount += 1;
    }

    return this.getState(bandOnsets, flux, onDownbeat, onsetStrength);
  }

  getState(bandOnsets = [false, false, false], flux = 0, onDownbeat = false, onsetStrength = 0) {
    return {
      time: this.time,
      bpm: this.bpm,
      period: this.period,
      phase: this.phase,      // within beat [0..1)
      barPhase: this.barPhase, // within bar [0..1)
      onBeat: this.onBeat,
      onDownbeat: !!onDownbeat,
      beatCount: this.beatCount,
      barCount: this.barCount,
      confidence: this.confidence,
      flux,
      onsetStrength: Math.max(0, Math.min(1, onsetStrength)),
      onBass: !!bandOnsets[0],
      onMid: !!bandOnsets[1],
      onTreb: !!bandOnsets[2],
    };
  }
}


