import "ecma-proposal-math-extensions";
import "./presetBase";
import Visualizer from "./visualizer";
import NoiseSuppressor from "./audio/noiseSuppression";

export default class VeedSync {
  static createVisualizer(context, canvas, opts) {
    return new Visualizer(context, canvas, opts);
  }

  // Surface the suppressor class for advanced users
  static get NoiseSuppressor() {
    return NoiseSuppressor;
  }
}
