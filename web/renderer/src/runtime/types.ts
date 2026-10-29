// Contract between the runtime and every wallpaper preset.
// A preset is a manifest (pure data, also read by the native app) plus a factory.

export type RendererKind = 'canvas2d' | 'webgl' | 'pixi' | 'three';

export interface RangeParam {
  key: string;
  label: string;
  type: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ColorParam {
  key: string;
  label: string;
  type: 'color';
  default: string;
}

export interface BoolParam {
  key: string;
  label: string;
  type: 'bool';
  default: boolean;
}

export interface SelectParam {
  key: string;
  label: string;
  type: 'select';
  options: string[];
  default: string;
}

export interface TextParam {
  key: string;
  label: string;
  type: 'text';
  default: string;
  maxLength?: number;
}

export type ParamSpec = RangeParam | ColorParam | BoolParam | SelectParam | TextParam;
export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

export interface PresetManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  renderer: RendererKind;
  /** Two colours used by the native gallery for the card backdrop. */
  accent: [string, string];
  author: string;
  license: string;
  params: ParamSpec[];
}

export interface PresetContext {
  /** Element the preset mounts its canvas into. */
  host: HTMLElement;
  width: number;
  height: number;
  dpr: number;
  params: ParamValues;
  /** Seeded RNG so "regenerate" can produce reproducible variations. */
  random: () => number;
  seed: number;
}

export interface PresetInstance {
  /** dt and time are in seconds; dt is already scaled by the global speed. */
  update(dt: number, time: number): void;
  resize(width: number, height: number, dpr: number): void;
  setParams(params: ParamValues): void;
  dispose(): void;
}

export interface PresetModule {
  create(ctx: PresetContext): PresetInstance | Promise<PresetInstance>;
}
