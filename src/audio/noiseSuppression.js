// Lightweight wrapper around a JS/WASM noise suppression library.
// Currently uses @vonage/noise-suppression to provide RNNoise-based suppression.
// This module abstracts the initialization and processing so callers can
// request a processed MediaStream from an input MediaStream.

import { createVonageNoiseSuppression } from "@vonage/noise-suppression";

export default class NoiseSuppressor {
  constructor() {
    this.processor = null;
    this.connector = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.processor = createVonageNoiseSuppression();
    await this.processor.init();
    this.connector = await this.processor.getConnector();
    this.initialized = true;
  }

  // Takes a MediaStream with at least one audio track and returns a new
  // MediaStream containing a single processed audio track.
  async processStream(inputStream) {
    if (!this.initialized) await this.init();
    if (!inputStream) throw new Error("NoiseSuppressor.processStream: inputStream required");
    const audioTrack = inputStream.getAudioTracks && inputStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("NoiseSuppressor.processStream: no audio track found");
    const processedTrack = await this.connector.setTrack(audioTrack);
    const out = new MediaStream();
    out.addTrack(processedTrack);
    return { processedStream: out, processedTrack };
  }

  async dispose() {
    try {
      // Best-effort cleanup; API surface may evolve.
      if (this.connector && this.connector.setTrack) {
        // Unset track to release resources if supported.
        try { await this.connector.setTrack(null); } catch (_) {}
      }
      if (this.processor && this.processor.close) {
        try { await this.processor.close(); } catch (_) {}
      }
    } finally {
      this.processor = null;
      this.connector = null;
      this.initialized = false;
    }
  }
}


