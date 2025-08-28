const isSupported = () => {
  const canvas = document.createElement("canvas");
  let gl;
  try {
    gl = canvas.getContext("webgl2");
  } catch (x) {
    gl = null;
  }

  const webGL2Supported = !!gl;
  const webGPUSupported = typeof navigator !== "undefined" && !!navigator.gpu;
  const audioApiSupported = !!(
    window.AudioContext || window.webkitAudioContext
  );

  return (webGL2Supported || webGPUSupported) && audioApiSupported;
};

export default isSupported;
