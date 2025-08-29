// Curated realistic scene presets using available local OBJ models
// Each scene describes: key, label, modelPath, optional vibe, postFX, and model parameters

const Scenes = [
  {
    key: "city_night_alley",
    label: "City Night Alley (Portrait)",
    modelPath: "assets/models/human/male02.obj",
    vibeKey: "neon_city",
    postFX: { exposure: -0.08, tonemap: 0.9, saturation: 0.12, contrast: 0.12, vignette: 0.3, tint: [0.92, 1.02, 1.10] },
    modelParams: { pointSize: 2.2, scale: 0.62, spinSpeed: 0.28 },
    particles: { enabled: true, maxCount: 900 },
  },
  {
    key: "city_neon_rain",
    label: "City Neon Rain (Portrait)",
    modelPath: "assets/models/human/female02.obj",
    vibeKey: "neon_city",
    postFX: { exposure: -0.06, tonemap: 0.92, saturation: 0.16, contrast: 0.14, vignette: 0.34, grain: 0.2, tint: [0.9, 1.03, 1.12] },
    modelParams: { pointSize: 2.4, scale: 0.64, spinSpeed: 0.26 },
    particles: { enabled: true, maxCount: 1100 },
  },
  {
    key: "rural_field_dusk",
    label: "Rural Field at Dusk",
    modelPath: "assets/models/animals/cow.obj",
    vibeKey: "nature_doc",
    postFX: { exposure: -0.12, tonemap: 0.9, saturation: -0.02, contrast: 0.02, vignette: 0.22, tint: [1.02, 0.99, 0.96] },
    modelParams: { pointSize: 2.2, scale: 0.7, spinSpeed: 0.12 },
    particles: { enabled: false },
  },
  {
    key: "museum_bust",
    label: "Museum Bust (Spotlit)",
    modelPath: "assets/models/supernatural/walt_head.obj",
    vibeKey: "nature_doc",
    postFX: { exposure: -0.1, tonemap: 0.95, saturation: -0.06, contrast: 0.08, vignette: 0.26, tint: [0.98, 1.0, 1.02] },
    modelParams: { pointSize: 2.0, scale: 0.58, spinSpeed: 0.10 },
    particles: { enabled: false },
  },
  {
    key: "studio_portrait",
    label: "Studio Portrait (Low-Key)",
    modelPath: "assets/models/human/female02.obj",
    vibeKey: "sunset_beach",
    postFX: { exposure: -0.14, tonemap: 0.85, saturation: 0.05, contrast: 0.06, vignette: 0.35, tint: [1.02, 0.98, 0.98] },
    modelParams: { pointSize: 2.3, scale: 0.62, spinSpeed: 0.20 },
    particles: { enabled: false },
  },
];

export function listScenes() {
  return Scenes.map(({ key, label }) => ({ key, label }));
}

export default Scenes;


