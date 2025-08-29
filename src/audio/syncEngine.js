import BeatSync from "./beatSync";
import MomentSync from "./momentSync";

export default class SyncEngine {
  constructor(opts = {}) {
    const beatOpts = {
      expectedBpm: opts.expectedBpm || opts.bpm || 120,
      meter: opts.meter || 4,
      hysteresis: opts.hysteresis,
      minBeatInterval: opts.minBeatInterval,
      sensitivity: opts.sensitivity,
      threshold: opts.threshold,
    };
    const momentOpts = {
      divisionsPerBar: opts.divisionsPerBar || opts.momentDivisions || [4, 8, 16],
      swing: (opts.swing != null) ? opts.swing : 0.14,
      phraseBars: opts.phraseBars || 8,
      latencySeconds: (opts.latencySeconds != null) ? opts.latencySeconds : -0.03,
      cinematicSmoothingPerSecond: (opts.cinematicSmoothingPerSecond != null) ? opts.cinematicSmoothingPerSecond : 0.25,
    };

    this.beat = new BeatSync(beatOpts);
    this.moment = new MomentSync(momentOpts);

    this.config = {
      confThreshold: (opts.confThreshold != null) ? opts.confThreshold : 0.5,
      gateDivision: opts.gateDivision || 8,
      autoBands: true,
    };

    this._bandsReady = false;
  }

  setConfig(opts = {}) {
    this.config = Object.assign({}, this.config, opts);
    if (opts.expectedBpm || opts.meter || opts.sensitivity || opts.threshold) {
      this.beat.setConfig({
        expectedBpm: opts.expectedBpm,
        meter: opts.meter,
        sensitivity: opts.sensitivity,
        threshold: opts.threshold,
      });
    }
    if (
      opts.divisionsPerBar || opts.momentDivisions || opts.swing != null ||
      opts.phraseBars != null || opts.latencySeconds != null || opts.cinematicSmoothingPerSecond != null
    ) {
      this.moment.setConfig({
        divisionsPerBar: opts.divisionsPerBar || opts.momentDivisions,
        swing: opts.swing,
        phraseBars: opts.phraseBars,
        latencySeconds: opts.latencySeconds,
        cinematicSmoothingPerSecond: opts.cinematicSmoothingPerSecond,
      });
    }
  }

  setBands(ranges) {
    if (this.beat && this.beat.setBands) this.beat.setBands(ranges);
    this._bandsReady = true;
  }

  _ensureBands(sampleRate, fftSize) {
    if (this._bandsReady) return;
    if (!sampleRate || !fftSize) return;
    const bucketHz = sampleRate / fftSize;
    const bassLow = Math.max(0, Math.round(20 / bucketHz) - 1);
    const bassHigh = Math.max(0, Math.round(320 / bucketHz) - 1);
    const midHigh = Math.max(0, Math.round(2800 / bucketHz) - 1);
    const trebHigh = Math.max(0, Math.round(11025 / bucketHz) - 1);
    this.setBands([
      { start: bassLow, stop: bassHigh },
      { start: bassHigh, stop: midHigh },
      { start: midHigh, stop: trebHigh },
    ]);
  }

  update(dt, spectrum, sampleRate, fftSize) {
    if (!spectrum) return null;
    if (this.config.autoBands) this._ensureBands(sampleRate, fftSize);

    const beatState = this.beat.update(dt, spectrum);
    if (!beatState) return null;

    // Fill meter if not present on beat state
    beatState.meter = this.beat.meter || beatState.meter || 4;

    const momentState = this.moment.update(dt, beatState) || null;

    // Confidence gating to reduce false triggers
    const conf = Math.max(0, Math.min(1, beatState.confidence || 0));
    const confTh = this.config.confThreshold;
    const safe = (flag) => (conf >= confTh) && !!flag;

    const divs = (momentState && momentState.divisions) || {};
    const d4 = divs[4] || { phase: 0, on: false };
    const d8 = divs[8] || { phase: 0, on: false };
    const d16 = divs[16] || { phase: 0, on: false };

    return {
      // Beat
      time: beatState.time,
      bpm: beatState.bpm,
      period: beatState.period,
      phase: beatState.phase,
      barPhase: beatState.barPhase,
      onBeat: safe(beatState.onBeat),
      onDownbeat: safe(beatState.onDownbeat),
      beatCount: beatState.beatCount,
      barCount: beatState.barCount,
      confidence: conf,
      flux: beatState.flux || 0,
      onBass: safe(beatState.onBass),
      onMid: safe(beatState.onMid),
      onTreb: safe(beatState.onTreb),
      meter: beatState.meter,

      // Moments
      momentBarPhase: momentState ? momentState.barPhase : 0,
      phrasePhase: momentState ? momentState.phrasePhase : 0,
      cinematicPhase: momentState ? momentState.cinematicPhase : 0,
      div4Phase: d4.phase,
      div8Phase: d8.phase,
      div16Phase: d16.phase,
      on_div4: safe(d4.on),
      on_div8: safe(d8.on),
      on_div16: safe(d16.on),
    };
  }
}


