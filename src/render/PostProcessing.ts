import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export const POST_PROCESSING_CONFIG = {
  vignetteIntensity: 0.35,
  vignetteRadius: 0.7,
  filmGrainIntensity: 0.05,
  colorGradeSaturation: 0.9,
};

const vignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignetteIntensity: { value: POST_PROCESSING_CONFIG.vignetteIntensity },
    vignetteRadius: { value: POST_PROCESSING_CONFIG.vignetteRadius },
    grainIntensity: { value: POST_PROCESSING_CONFIG.filmGrainIntensity },
    saturation: { value: POST_PROCESSING_CONFIG.colorGradeSaturation },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignetteIntensity;
    uniform float vignetteRadius;
    uniform float grainIntensity;
    uniform float saturation;
    uniform float time;
    varying vec2 vUv;

    float random(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);

      float gray = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
      vec3 graded = mix(vec3(gray), texel.rgb, saturation);

      vec2 centered = vUv - 0.5;
      float dist = length(centered);
      float vignette = smoothstep(vignetteRadius, vignetteRadius - 0.35, dist);
      vignette = mix(1.0 - vignetteIntensity, 1.0, vignette);

      float grain = (random(vUv * time) - 0.5) * grainIntensity;

      gl_FragColor = vec4(graded * vignette + grain, texel.a);
    }
  `,
};

export interface PostProcessingPipeline {
  render(): void;
  update(deltaSec: number): void;
  setSize(width: number, height: number): void;
}

/**
 * Виньетка + лёгкая десатурация + film grain одним шейдер-проходом поверх
 * RenderPass. Значения в POST_PROCESSING_CONFIG — стартовые, финальные подбирает
 * дизайнер (раздел 4.3 ТЗ).
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostProcessingPipeline {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const effectPass = new ShaderPass(vignetteGrainShader);
  composer.addPass(effectPass);
  composer.addPass(new OutputPass());

  let elapsedSec = 0;

  return {
    render: () => composer.render(),
    update: (deltaSec: number) => {
      elapsedSec += deltaSec;
      effectPass.uniforms.time.value = elapsedSec;
    },
    setSize: (width: number, height: number) => composer.setSize(width, height),
  };
}
