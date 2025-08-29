export default class AudioFeatures {
  constructor(audio) {
    this.audio = audio; // expects AudioProcessor
    this.sampleRate = (audio && audio.audioContext && audio.audioContext.sampleRate) || 44100;
    this.numSamps = (audio && audio.numSamps) || 512;

    this.features = {
      rms: 0,
      zcr: 0,
      centroidHz: 0,
      rolloffHz: 0,
      crest: 0,
      energy: 0,
    };
  }

  update() {
    const timeL = this.audio.timeArrayL;
    const timeR = this.audio.timeArrayR;
    const time = (timeL && timeR && timeL.length === timeR.length)
      ? this._mixMono(timeL, timeR)
      : (this.audio.timeArray || this.audio.timeByteArraySignedL || null);

    const freq = this.audio.freqArray || null;
    if (!time || !freq) return this.features;

    const N = time.length;
    // RMS (time domain), scale to 0..1 using int8 range
    let sumSq = 0;
    let zeroCross = 0;
    for (let i = 0; i < N; i++) {
      const v = time[i] / 128; // int8 -> [-1,1)
      sumSq += v * v;
      if (i > 0) {
        if ((time[i - 1] < 0 && time[i] >= 0) || (time[i - 1] >= 0 && time[i] < 0)) zeroCross += 1;
      }
    }
    const rms = Math.sqrt(sumSq / N);
    const zcr = zeroCross / N; // approx proportion of zero crossings

    // Spectral metrics (freq domain) - freqArray already represents magnitudes
    const M = freq.length;
    let magSum = 0;
    let wSum = 0;
    let maxMag = 0;
    for (let i = 0; i < M; i++) {
      const m = Math.max(0, freq[i]);
      const f = (i * this.sampleRate) / (2 * M); // bins over Nyquist
      magSum += m;
      wSum += f * m;
      if (m > maxMag) maxMag = m;
    }
    const centroidHz = magSum > 0 ? (wSum / magSum) : 0;

    // Rolloff (0.85 energy)
    const target = 0.85 * magSum;
    let accum = 0;
    let rollIdx = M - 1;
    for (let i = 0; i < M; i++) {
      accum += Math.max(0, freq[i]);
      if (accum >= target) { rollIdx = i; break; }
    }
    const rolloffHz = (rollIdx * this.sampleRate) / (2 * M);

    // Spectral crest = peak / mean
    const meanMag = magSum / Math.max(1, M);
    const crest = meanMag > 1e-6 ? (maxMag / meanMag) : 0;

    const energy = Math.max(0, Math.min(1, 0.6 * (this.audioLevels?.bass_att || 1) + 0.3 * (this.audioLevels?.mid_att || 1) + 0.1 * (this.audioLevels?.treb_att || 1)));

    this.features = { rms, zcr, centroidHz, rolloffHz, crest, energy };
    return this.features;
  }

  _mixMono(a, b) {
    const out = new Int8Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const m = (a[i] + b[i]) * 0.5;
      out[i] = m;
    }
    return out;
  }
}


