# Veed Sync

Veed Sync is a modern WebGL music visualizer inspired by MilkDrop.


## Try it out

Open `examples/viz.html` locally after building, or host it on a static server.

### Download demo assets (optional)

Models:

```bash
node scripts/download-models.js
```

Images (requires free Pixabay API key):

```bash
export PIXABAY_API_KEY=YOUR_KEY
node scripts/download-assets.js
```

## Usage

### Installation

With [pnpm](https://pnpm.io/), [yarn](https://yarnpkg.com/) or [npm](https://npmjs.org/) installed, run

    $ pnpm add veed-sync butterchurn-presets
    or
    $ yarn add veed-sync butterchurn-presets
    or
    $ npm install veed-sync butterchurn-presets

### Create a visualizer

```JavaScript
import veedSync from 'veed-sync';
import butterchurnPresets from 'butterchurn-presets';

// initialize audioContext and get canvas

const visualizer = veedSync.createVisualizer(audioContext, canvas, {
  width: 800,
  height: 600
});

// get audioNode from audio source or microphone

visualizer.connectAudio(audioNode);

// load a preset

const presets = butterchurnPresets.getPresets();
const preset = presets['Flexi, martin + geiss - dedicated to the sherwin maxawow'];

visualizer.loadPreset(preset, 0.0); // 2nd argument is the number of seconds to blend presets

// resize visualizer

visualizer.setRendererSize(1600, 1200);

// render a frame

visualizer.render();
```

### Microphone sensitivity and noise suppression

```JavaScript
// Start mic capture with built-in WebRTC constraints and optional RNNoise suppression
await visualizer.startMicCaptureEnhanced({
  constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } },
  suppression: 'rnnoise', // or 'none'
  sensitivity: 1.5,
});

// Adjust input sensitivity (pre-analysis gain)
visualizer.setMicSensitivity(1.8);
```

### Browser Support

Veed Sync requires a browser with WebGL 2 or WebGPU and the Web Audio API.

You can test for support using our minimal isSupported script:

```Javacript
import isSupported from "veed-sync/dist/isSupported.min.js";

if (isSupported()) {
  // Safe to load Veed Sync
}
```

## Integrations
* [Webamp](https://github.com/captbaritone/webamp), the fantastic reimplementation of Winamp 2.9 in HTML5 and Javascript, built by [captbaritone](https://github.com/captbaritone)
* [mStream](http://mstream.io/), your personal music streaming server, built by [IrosTheBeggar](https://github.com/IrosTheBeggar)
* [pasteur](https://www.pasteur.cc/), trippy videos generated from your music, built by [markneub](https://github.com/markneub)
* [ChromeAudioVisualizerExtension](https://chrome.google.com/webstore/detail/audiovisualizer/bojhikphaecldnbdekplmadjkflgbkfh), put on some music and turn your browsing session into a party! built by [afreakk](https://github.com/afreakk)
* [Karaoke Forever](https://www.karaoke-forever.com), an open karaoke party system, built by [bhj](https://github.com/bhj)
* [Syqel](https://syqel.com/), the World's Best AI Powered Music Visualizer


## Thanks

* [Ryan Geiss](http://www.geisswerks.com/) for creating [MilkDrop](http://www.geisswerks.com/about_milkdrop.html)
* Nullsoft for creating [Winamp](http://www.winamp.com/)
* All the amazing preset creators, special thanks to [Flexi](https://twitter.com/Flexi23)


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. Developed by Chamath Thiwanka.
