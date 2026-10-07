import * as THREE from 'three/webgpu';
import { Fn, clamp, dot, float, length, mix, pass, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { POST_PRESETS, nextQuality, type PostQuality, type PostSettings } from './postSettings';

export interface Post {
  readonly quality: PostQuality;
  setQuality(q: PostQuality): void;
  /** Advances low -> medium -> high -> low and returns the new quality. */
  cycle(): PostQuality;
  /** Drop-in replacement for renderer.render(scene, camera). */
  render(): void;
}

/**
 * Post-processing chain (three/webgpu PostProcessing, TSL nodes only):
 * scene pass -> GTAO -> bloom -> stylised grade -> FXAA, then the renderer's tone mapping and
 * colour-space conversion at the pipeline output. The low preset bypasses the pipeline entirely.
 */
export function createPost(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  initial: PostQuality = 'medium',
): Post {
  const grade = {
    saturation: uniform(1),
    contrast: uniform(1),
    splitTone: uniform(0),
    vignette: uniform(0),
  };

  let quality = initial;
  const pipeline = new THREE.PostProcessing(renderer);

  const rebuild = (s: PostSettings) => {
    const scenePass = pass(scene, camera);
    let color: THREE.Node<'vec4'> = scenePass.getTextureNode();

    if (s.ao) {
      const aoPass = ao(scenePass.getTextureNode('depth'), null as unknown as THREE.Node, camera);
      aoPass.resolutionScale = s.aoResolutionScale;
      aoPass.samples.value = s.aoSamples;
      aoPass.radius.value = s.aoRadius;
      const occlusion = aoPass.getTextureNode().r.pow(s.aoIntensity);
      color = vec4(color.rgb.mul(occlusion), color.a);
    }

    let out: THREE.Node<'vec4'> = color;
    if (s.bloom) out = out.add(bloom(color, s.bloomStrength, s.bloomRadius, s.bloomThreshold));

    if (s.grade) {
      const gradeFn = Fn(([c]: [any]) => {
        let rgb = c.rgb;
        const luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3(luma), rgb, grade.saturation);
        // Contrast pivots around mid grey so exposure is untouched.
        rgb = rgb.sub(0.18).mul(grade.contrast).add(0.18).max(0);
        // Cool shadows, warm highlights: chunky storybook look.
        const t = smoothstep(0.0, 1.0, clamp(luma, 0, 1));
        const tone = mix(vec3(0.94, 0.99, 1.08), vec3(1.07, 1.02, 0.92), t);
        rgb = mix(rgb, rgb.mul(tone), grade.splitTone);
        const vig = smoothstep(0.95, 0.35, length(screenUV.sub(0.5)).mul(1.25));
        rgb = rgb.mul(mix(float(1), vig, grade.vignette));
        return vec4(rgb, c.a);
      });
      out = gradeFn(out);
    }

    // The pipeline applies tone mapping and sRGB after this node, so FXAA sees linear colour.
    pipeline.outputColorTransform = true;
    pipeline.outputNode = s.fxaa ? fxaa(out) : out;
    pipeline.needsUpdate = true;
  };

  const apply = () => {
    const s = POST_PRESETS[quality];
    grade.saturation.value = s.saturation;
    grade.contrast.value = s.contrast;
    grade.splitTone.value = s.splitTone;
    grade.vignette.value = s.vignette;
    if (s.enabled) rebuild(s);
  };
  apply();

  return {
    get quality() {
      return quality;
    },
    setQuality(q) {
      quality = q;
      apply();
    },
    cycle() {
      this.setQuality(nextQuality(quality));
      return quality;
    },
    render() {
      if (POST_PRESETS[quality].enabled) pipeline.render();
      else renderer.render(scene, camera);
    },
  };
}
