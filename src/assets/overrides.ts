import type { Group } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Asset override system: maps original model names (e.g. `inn`, `tree1`,
 * `chest_nl`) to replacement .glb files, with a transform to line the new
 * model up with the original's coordinate frame. Names without an override
 * fall back to the original model.
 */

export interface ModelOverride {
  /** Path of the .glb, relative to the manifest URL. */
  file: string;
  /** Uniform (number) or per-axis scale. Default 1. */
  scale: [number, number, number];
  /** Euler XYZ rotation in radians. Default 0. */
  rotation: [number, number, number];
  /** Offset in model units, applied after scale and rotation. Default 0. */
  offset: [number, number, number];
}

export interface OverrideManifest {
  version: 1;
  models: Map<string, ModelOverride>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Invalid override manifest: ${message}`);
    this.name = 'ManifestError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseVec3(
  value: unknown,
  fallback: number,
  where: string,
  allowScalar: boolean,
): [number, number, number] {
  if (value === undefined) return [fallback, fallback, fallback];
  if (allowScalar && typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ManifestError(`${where} must be finite`);
    return [value, value, value];
  }
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new ManifestError(`${where} must be an array of 3 finite numbers`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

/** Validates parsed JSON and normalizes it. Model names are case-insensitive (stored lowercase). */
export function parseManifest(json: unknown): OverrideManifest {
  if (!isRecord(json)) throw new ManifestError('root must be an object');
  if (json.version !== 1) throw new ManifestError('version must be 1');
  if (!isRecord(json.models)) throw new ManifestError('"models" must be an object');

  const models = new Map<string, ModelOverride>();
  for (const [rawName, entry] of Object.entries(json.models)) {
    const name = rawName.toLowerCase();
    if (!name) throw new ManifestError('model name must not be empty');
    if (models.has(name)) throw new ManifestError(`duplicate model name "${name}"`);
    if (!isRecord(entry)) throw new ManifestError(`"${rawName}" must be an object`);
    const { file } = entry;
    if (typeof file !== 'string' || !/\.glb$/i.test(file)) {
      throw new ManifestError(`"${rawName}".file must be a string ending in .glb`);
    }
    if (file.startsWith('/') || file.split(/[\\/]/).includes('..') || /^[a-z]+:/i.test(file)) {
      throw new ManifestError(`"${rawName}".file must be a relative path without ".."`);
    }
    const scale = parseVec3(entry.scale, 1, `"${rawName}".scale`, true);
    if (scale.some((s) => s === 0)) throw new ManifestError(`"${rawName}".scale must be non-zero`);
    models.set(name, {
      file,
      scale,
      rotation: parseVec3(entry.rotation, 0, `"${rawName}".rotation`, false),
      offset: parseVec3(entry.offset, 0, `"${rawName}".offset`, false),
    });
  }
  return { version: 1, models };
}

export type ResolvedModel =
  | { fallback: false; name: string; scene: Group }
  | { fallback: true; name: string };

/** Loads a .glb URL to a scene. Injectable so tests need no network or WebGL. */
export type GlbLoadFn = (url: string) => Promise<Group>;

const defaultLoad: GlbLoadFn = async (url) => {
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene as unknown as Group;
};

export class AssetOverrides {
  private readonly cache = new Map<string, Promise<Group | null>>();

  constructor(
    private readonly manifest: OverrideManifest,
    private readonly baseUrl: string,
    private readonly load: GlbLoadFn = defaultLoad,
  ) {}

  /** Fetches and parses a manifest; a missing manifest yields an empty one. */
  static async fromUrl(
    manifestUrl = '/models/manifest.json',
    load?: GlbLoadFn,
  ): Promise<AssetOverrides> {
    const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
    const res = await fetch(manifestUrl);
    const manifest = res.ok ? parseManifest(await res.json()) : { version: 1 as const, models: new Map() };
    return new AssetOverrides(manifest, baseUrl, load);
  }

  has(name: string): boolean {
    return this.manifest.models.has(name.toLowerCase());
  }

  get(name: string): ModelOverride | undefined {
    return this.manifest.models.get(name.toLowerCase());
  }

  /**
   * Returns a fresh clone of the override scene with the manifest transform
   * applied, or `{ fallback: true }` when no override exists or loading failed.
   * The .glb is loaded once per name; callers own the returned clone.
   */
  async resolve(name: string): Promise<ResolvedModel> {
    const key = name.toLowerCase();
    const override = this.manifest.models.get(key);
    if (!override) return { fallback: true, name };

    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.load(this.baseUrl + override.file).catch((err) => {
        console.warn(`Override for "${name}" failed to load, using original model`, err);
        return null;
      });
      this.cache.set(key, pending);
    }
    const source = await pending;
    if (!source) return { fallback: true, name };

    const scene = source.clone(true);
    scene.scale.set(...override.scale);
    scene.rotation.set(...override.rotation);
    scene.position.set(...override.offset);
    return { fallback: false, name, scene };
  }
}
