export default class AudioLevels {
  constructor(audio) {
    this.audio = audio;

    let sampleRate;
    if (this.audio.audioContext) {
      sampleRate = this.audio.audioContext.sampleRate;
    } else {
      sampleRate = 44100;
    }

    const bucketHz = sampleRate / this.audio.fftSize;

    const bassLow = Math.clamp(
      Math.round(20 / bucketHz) - 1,
      0,
      this.audio.numSamps - 1
    );
    const bassHigh = Math.clamp(
      Math.round(320 / bucketHz) - 1,
      0,
      this.audio.numSamps - 1
    );
    const midHigh = Math.clamp(
      Math.round(2800 / bucketHz) - 1,
      0,
      this.audio.numSamps - 1
    );
    const trebHigh = Math.clamp(
      Math.round(11025 / bucketHz) - 1,
      0,
      this.audio.numSamps - 1
    );

    this.starts = [bassLow, bassHigh, midHigh];
    this.stops = [bassHigh, midHigh, trebHigh];

    this.val = new Float32Array(3);
    this.imm = new Float32Array(3);
    this.att = new Float32Array(3);
    this.avg = new Float32Array(3);
    this.longAvg = new Float32Array(3);

    this.att.fill(1);
    this.avg.fill(1);
    this.longAvg.fill(1);

    // User-configurable response controls
    this.response = {
      gain: 1.0,              // scales band energy before normalization
      attack: 0.2,            // 0..1 (faster upwards)
      release: 0.5,           // 0..1 (faster downwards)
      longAvgFast: 0.9,       // boot warm-up
      longAvgSlow: 0.992,     // steady state
    };
  }

  /* eslint-disable camelcase */
  get bass() {
    return this.val[0];
  }

  get bass_att() {
    return this.att[0];
  }

  get mid() {
    return this.val[1];
  }

  get mid_att() {
    return this.att[1];
  }

  get treb() {
    return this.val[2];
  }

  get treb_att() {
    return this.att[2];
  }
  /* eslint-enable camelcase */

  static isFiniteNumber(num) {
    return Number.isFinite(num) && !Number.isNaN(num);
  }

  static adjustRateToFPS(rate, baseFPS, FPS) {
    return rate ** (baseFPS / FPS);
  }

  updateAudioLevels(fps, frame) {
    if (this.audio.freqArray.length > 0) {
      let effectiveFPS = fps;
      if (!AudioLevels.isFiniteNumber(effectiveFPS) || effectiveFPS < 15) {
        effectiveFPS = 15;
      } else if (effectiveFPS > 144) {
        effectiveFPS = 144;
      }

      // Clear for next loop
      this.imm.fill(0);
      for (let i = 0; i < 3; i++) {
        for (let j = this.starts[i]; j < this.stops[i]; j++) {
          this.imm[i] += this.audio.freqArray[j];
        }
      }

      for (let i = 0; i < 3; i++) {
        const gain = Math.max(0, this.response.gain || 1.0);
        const immScaled = this.imm[i] * gain;

        let rate;
        const atk = AudioLevels.adjustRateToFPS(this.response.attack, 30.0, effectiveFPS);
        const rel = AudioLevels.adjustRateToFPS(this.response.release, 30.0, effectiveFPS);
        rate = immScaled > this.avg[i] ? atk : rel;
        this.avg[i] = this.avg[i] * rate + immScaled * (1 - rate);

        const warm = AudioLevels.adjustRateToFPS(this.response.longAvgFast, 30.0, effectiveFPS);
        const steady = AudioLevels.adjustRateToFPS(this.response.longAvgSlow, 30.0, effectiveFPS);
        const lr = frame < 50 ? warm : steady;
        this.longAvg[i] = this.longAvg[i] * lr + immScaled * (1 - lr);

        if (this.longAvg[i] < 0.001) {
          this.val[i] = 1.0;
          this.att[i] = 1.0;
        } else {
          this.val[i] = immScaled / this.longAvg[i];
          this.att[i] = this.avg[i] / this.longAvg[i];
        }
      }
    }
  }

  // API: Adjust band response
  setResponse({ gain, attack, release, longAvgFast, longAvgSlow } = {}) {
    if (Number.isFinite(gain)) this.response.gain = Math.max(0, gain);
    if (Number.isFinite(attack)) this.response.attack = Math.min(0.99, Math.max(0.0, attack));
    if (Number.isFinite(release)) this.response.release = Math.min(0.99, Math.max(0.0, release));
    if (Number.isFinite(longAvgFast)) this.response.longAvgFast = Math.min(0.999, Math.max(0.0, longAvgFast));
    if (Number.isFinite(longAvgSlow)) this.response.longAvgSlow = Math.min(0.9999, Math.max(0.0, longAvgSlow));
  }
}
