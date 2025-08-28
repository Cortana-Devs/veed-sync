import FFT from "./fft";

export default class AudioProcessor {
  constructor(context) {
    this.numSamps = 512;
    this.fftSize = this.numSamps * 2;

    this.fft = new FFT(this.fftSize, 512, true);

    if (context) {
      this.audioContext = context;
      this.audible = context.createDelay();
      // Input gain for sensitivity control
      this.inputGain = context.createGain();
      this.inputGain.gain.value = 1.0;

      this.analyser = context.createAnalyser();
      this.analyser.smoothingTimeConstant = 0.0;
      this.analyser.fftSize = this.fftSize;

      // Connect processing graph
      this.inputGain.connect(this.audible);
      this.audible.connect(this.analyser);

      // Split channels
      this.analyserL = context.createAnalyser();
      this.analyserL.smoothingTimeConstant = 0.0;
      this.analyserL.fftSize = this.fftSize;

      this.analyserR = context.createAnalyser();
      this.analyserR.smoothingTimeConstant = 0.0;
      this.analyserR.fftSize = this.fftSize;

      this.splitter = context.createChannelSplitter(2);

      this.audible.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
    }

    // Initialised once as typed arrays
    // Used for webaudio API raw (time domain) samples. 0 -> 255
    this.timeByteArray = new Uint8Array(this.fftSize);
    this.timeByteArrayL = new Uint8Array(this.fftSize);
    this.timeByteArrayR = new Uint8Array(this.fftSize);

    // Signed raw samples shifted to -128 -> 127
    this.timeArray = new Int8Array(this.fftSize);
    this.timeByteArraySignedL = new Int8Array(this.fftSize);
    this.timeByteArraySignedR = new Int8Array(this.fftSize);

    // Temporary array for smoothing
    this.tempTimeArrayL = new Int8Array(this.fftSize);
    this.tempTimeArrayR = new Int8Array(this.fftSize);

    // Undersampled from this.fftSize to this.numSamps
    this.timeArrayL = new Int8Array(this.numSamps);
    this.timeArrayR = new Int8Array(this.numSamps);

    // User-adjustable smoothing (temporal pre-FFT)
    this.temporalSmoothing = 0.5; // 0..1, 0 = follow last sample, 1 = follow current sample
  }

  sampleAudio() {
    this.analyser.getByteTimeDomainData(this.timeByteArray);
    this.analyserL.getByteTimeDomainData(this.timeByteArrayL);
    this.analyserR.getByteTimeDomainData(this.timeByteArrayR);
    this.processAudio();
  }
  updateAudio(timeByteArray, timeByteArrayL, timeByteArrayR) {
    this.timeByteArray.set(timeByteArray);
    this.timeByteArrayL.set(timeByteArrayL);
    this.timeByteArrayR.set(timeByteArrayR);
    this.processAudio();
  }
  /* eslint-disable no-bitwise */
  processAudio() {
    for (let i = 0, j = 0, lastIdx = 0; i < this.fftSize; i++) {
      // Shift Unsigned to Signed about 0
      this.timeArray[i] = this.timeByteArray[i] - 128;
      this.timeByteArraySignedL[i] = this.timeByteArrayL[i] - 128;
      this.timeByteArraySignedR[i] = this.timeByteArrayR[i] - 128;

      const a = this.temporalSmoothing;
      const b = 1.0 - a;
      this.tempTimeArrayL[i] = a * this.timeByteArraySignedL[i] + b * this.timeByteArraySignedL[lastIdx];
      this.tempTimeArrayR[i] = a * this.timeByteArraySignedR[i] + b * this.timeByteArraySignedR[lastIdx];

      // Undersampled
      if (i % 2 === 0) {
        this.timeArrayL[j] = this.tempTimeArrayL[i];
        this.timeArrayR[j] = this.tempTimeArrayR[i];
        j += 1;
      }

      lastIdx = i;
    }

    // Use full width samples for the FFT
    this.freqArray = this.fft.timeToFrequencyDomain(this.timeArray);
    this.freqArrayL = this.fft.timeToFrequencyDomain(this.timeByteArraySignedL);
    this.freqArrayR = this.fft.timeToFrequencyDomain(this.timeByteArraySignedR);
  }

  connectAudio(audionode) {
    if (this.inputGain) {
      audionode.connect(this.inputGain);
    } else {
      audionode.connect(this.audible);
    }
  }

  disconnectAudio(audionode) {
    if (this.inputGain) {
      audionode.disconnect(this.inputGain);
    } else {
      audionode.disconnect(this.audible);
    }
  }
  
  // Sensitivity (input gain)
  setSensitivity(mult) {
    if (this.inputGain && Number.isFinite(mult)) {
      this.inputGain.gain.value = Math.max(0, mult);
    }
  }

  // WebAudio analyser smoothing (0..1). Affects native analyser outputs.
  setAnalyserSmoothing(value) {
    const v = Math.min(0.99, Math.max(0.0, value || 0));
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
    if (this.analyserL) this.analyserL.smoothingTimeConstant = v;
    if (this.analyserR) this.analyserR.smoothingTimeConstant = v;
  }

  // Pre-FFT temporal smoothing of time-domain samples (0..1)
  setTemporalSmoothing(value) {
    const v = Math.min(1.0, Math.max(0.0, value || 0));
    this.temporalSmoothing = v;
  }
  /* eslint-enable no-bitwise */
}
