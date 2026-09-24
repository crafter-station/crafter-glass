import {
  draw,
  effect,
  frame,
  geometry,
  init,
  sampler,
  surface,
  target,
  type Draw,
  type Effect,
  type Gpu,
  type Surface,
  type Target,
} from "vgpu";
import type { KnotMesh } from "../knot";
import { createRig, floating, GROUND, knotScale, TEXT_DEPTH, type Pointer } from "../scene";
import { createTextSheet, type TextSheet } from "../text";
import { topDown, viewHeight, viewProjection } from "./camera";
import blurWgsl from "./shaders/blur.wgsl";
import compositeWgsl from "./shaders/composite.wgsl";
import copyWgsl from "./shaders/copy.wgsl";
import glassWgsl from "./shaders/glass.wgsl";
import groundWgsl from "./shaders/ground.wgsl";
import presentWgsl from "./shaders/present.wgsl";
import silhouetteWgsl from "./shaders/silhouette.wgsl";
import textWgsl from "./shaders/text.wgsl";

const BACKGROUND = 0.7454;
const REST_DISTANCE = 25 - TEXT_DEPTH;
const FONT = 14;
const FIT = 0.92;
const LIFT = 0;
const SHADOW_REACH = 8;
const SHADOW_SIZE = 128;
const SHADOW_LOW = 32;
const SHADOW_ROUNDS = 2;
const SHADOW_SPREAD = 2;
const SHADOW_OPACITY = 0.95;
const GROUND_EXTENT = 60;
const SOFT_SPREAD = 2.5;
const LIGHT = [20, 20, 10] as const;
const GLASS = { ior: 1.5, aberration: 0.06, reflections: 1, occlusion: 0.45, shine: 2.5 };
const FRONT = 2;
const BACK = 5;
const TILT = { focus: 0.12, falloff: 1, shade: 0.22, floor: 0.6 };

type Size = readonly [number, number];

export interface Renderer {
  readonly ready: Promise<void>;
  point(pointer: Pointer): void;
  dispose(): void;
}

interface Stage {
  readonly gpu: Gpu;
  readonly output: Surface;
  readonly scene: Target;
  readonly back: Target;
  readonly behind: Target;
  readonly lit: Target;
  readonly image: Target;
  readonly half: Target;
  readonly soft: readonly [Target, Target];
  readonly shadow: { readonly raw: Target; readonly mid: Target; readonly low: readonly [Target, Target] };
  readonly sheet: TextSheet;
  readonly text: Draw;
  readonly ground: Draw;
  readonly silhouette: Draw;
  readonly glassBack: Draw;
  readonly glass: Draw;
  readonly compositeBack: Effect;
  readonly composite: Effect;
  readonly shrinkMid: Effect;
  readonly shrinkLow: Effect;
  readonly shadowBlur: readonly [Effect, Effect];
  readonly downHalf: Effect;
  readonly softBlur: readonly [Effect, Effect];
  readonly present: Effect;
}

const halve = ([width, height]: Size): Size => [Math.max(1, width >> 1), Math.max(1, height >> 1)];

export function createRenderer(
  canvas: HTMLCanvasElement,
  mesh: Promise<KnotMesh>,
  lines: readonly string[],
): Renderer {
  let disposed = false;
  let gpu: Gpu | undefined;
  let stage: Stage | undefined;
  let request = 0;
  let previous = 0;
  let time = 0;
  let pointer: Pointer = { x: 0, y: 0 };
  const rig = createRig();

  const tick = (now: number) => {
    request = 0;
    if (disposed || !stage) return;
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    time += dt;
    rig.step(dt, pointer);
    render(stage, time, rig.eye);
    request = requestAnimationFrame(tick);
  };

  const start = async () => {
    gpu = await init();
    if (disposed) return gpu.dispose();
    const [first, sheet] = await Promise.all([mesh, createTextSheet(gpu, lines)]);
    if (disposed) return;
    const output = surface(gpu, canvas, { dpr: [1, 2] });
    const scene = target(gpu, { size: output.size, format: "rgba16float", label: "scene" });
    const back = target(gpu, {
      size: output.size,
      format: "rgba16float",
      msaa: true,
      depth: true,
      label: "back",
    });
    const behind = target(gpu, { size: output.size, format: "rgba16float", label: "behind" });
    const lit = target(gpu, {
      size: output.size,
      format: "rgba16float",
      msaa: true,
      depth: true,
      label: "lit",
    });
    const image = target(gpu, { size: output.size, format: "rgba16float", label: "image" });
    const half = target(gpu, { size: halve(output.size), format: "rgba16float", label: "half" });
    const soft = [0, 1].map((i) =>
      target(gpu!, { size: halve(output.size), format: "rgba16float", label: `soft-${i}` }),
    ) as [Target, Target];
    const shadow = {
      raw: target(gpu, { size: [SHADOW_SIZE, SHADOW_SIZE], format: "r8unorm", label: "shadow-raw" }),
      mid: target(gpu, {
        size: [SHADOW_SIZE >> 1, SHADOW_SIZE >> 1],
        format: "r8unorm",
        label: "shadow-mid",
      }),
      low: [0, 1].map((i) =>
        target(gpu!, { size: [SHADOW_LOW, SHADOW_LOW], format: "r8unorm", label: `shadow-low-${i}` }),
      ) as [Target, Target],
    };
    const clamp = sampler(gpu, {
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const glyphSampler = sampler(gpu, {
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      maxAnisotropy: 8,
    });
    const quad = geometry(gpu, {
      buffers: [
        { data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), attributes: { position: "float32x2" } },
      ],
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const knot = geometry(gpu, {
      buffers: [
        { data: first.positions, attributes: { position: "float32x3" } },
        { data: first.normals, attributes: { normal: "float32x3" } },
        { data: first.cores, attributes: { core: "float32x3" } },
        { data: first.occlusion, attributes: { occlusion: "float32" } },
      ],
      indices: first.indices,
    });
    const shape = geometry(gpu, {
      buffers: [{ data: first.positions, attributes: { position: "float32x3" } }],
      indices: first.indices,
    });

    const text = draw(gpu, {
      shader: textWgsl,
      geometry: quad,
      blend: "alpha",
      depth: false,
      cull: "none",
      label: "text",
      set: { glyphs: sheet.texture, glyphSampler },
    });
    const ground = draw(gpu, {
      shader: groundWgsl,
      geometry: quad,
      blend: "alpha",
      depth: false,
      cull: "none",
      label: "ground",
      set: { shadow: shadow.low[0], shadowSampler: clamp },
    });
    const silhouette = draw(gpu, {
      shader: silhouetteWgsl,
      geometry: shape,
      depth: false,
      cull: "none",
      label: "silhouette",
    });
    const glassBack = draw(gpu, {
      shader: glassWgsl,
      geometry: knot,
      cull: "front",
      label: "glass-back",
      set: { scene, sceneSampler: clamp },
    });
    const glass = draw(gpu, {
      shader: glassWgsl,
      geometry: knot,
      cull: "back",
      label: "glass",
      set: { scene: behind, sceneSampler: clamp },
    });
    const compositeBack = effect(gpu, compositeWgsl, {
      label: "composite-back",
      set: { backdrop: scene, glass: back, compositeSampler: clamp },
    });
    const composite = effect(gpu, compositeWgsl, {
      label: "composite",
      set: { backdrop: scene, glass: lit, compositeSampler: clamp },
    });
    const shrinkMid = effect(gpu, copyWgsl, {
      label: "shadow-mid",
      set: { src: shadow.raw, srcSampler: clamp },
    });
    const shrinkLow = effect(gpu, copyWgsl, {
      label: "shadow-low",
      set: { src: shadow.mid, srcSampler: clamp },
    });
    const step = SHADOW_SPREAD / SHADOW_LOW;
    const shadowBlur = [
      effect(gpu, blurWgsl, {
        label: "shadow-blur-h",
        set: { src: shadow.low[0], srcSampler: clamp, blur: { step: [step, 0] } },
      }),
      effect(gpu, blurWgsl, {
        label: "shadow-blur-v",
        set: { src: shadow.low[1], srcSampler: clamp, blur: { step: [0, step] } },
      }),
    ] as const;
    const downHalf = effect(gpu, copyWgsl, { label: "half", set: { src: image, srcSampler: clamp } });
    const softBlur = [
      effect(gpu, blurWgsl, { label: "soft-h", set: { src: half, srcSampler: clamp } }),
      effect(gpu, blurWgsl, { label: "soft-v", set: { src: soft[0], srcSampler: clamp } }),
    ] as const;
    const present = effect(gpu, presentWgsl, {
      label: "present",
      set: { sharp: image, soft: soft[1], presentSampler: clamp, present: TILT },
    });

    const current: Stage = {
      gpu,
      output,
      scene,
      back,
      behind,
      lit,
      image,
      half,
      soft,
      shadow,
      sheet,
      text,
      ground,
      silhouette,
      glassBack,
      glass,
      compositeBack,
      composite,
      shrinkMid,
      shrinkLow,
      shadowBlur,
      downHalf,
      softBlur,
      present,
    };
    fit(current);
    await Promise.all([
      text.compile(scene),
      ground.compile(scene),
      silhouette.compile(shadow.raw),
      glassBack.compile(back),
      compositeBack.compile(behind),
      glass.compile(lit),
      composite.compile(image),
      shrinkMid.compile(shadow.mid),
      shrinkLow.compile(shadow.low[0]),
      shadowBlur[0].compile(shadow.low[1]),
      shadowBlur[1].compile(shadow.low[0]),
      downHalf.compile(half),
      softBlur[0].compile(soft[0]),
      softBlur[1].compile(soft[1]),
      present.compile({ colors: [output.format] }),
    ]);
    if (disposed) return;
    stage = current;
    output.onResize(() => fit(current));
    previous = performance.now();
    request = requestAnimationFrame(tick);
  };

  const ready = start();

  return {
    ready,
    point(next) {
      pointer = next;
    },
    dispose() {
      disposed = true;
      if (request) cancelAnimationFrame(request);
      stage?.output.dispose();
      gpu?.dispose();
    },
  };
}

/** Sizes the screen targets to the surface and refreshes the blur steps that depend on them. */
function fit(stage: Stage): void {
  const { output, scene, back, behind, lit, image, half, soft, softBlur } = stage;
  if (scene.size[0] !== output.size[0] || scene.size[1] !== output.size[1]) {
    scene.resize(output.size);
    back.resize(output.size);
    behind.resize(output.size);
    lit.resize(output.size);
    image.resize(output.size);
    half.resize(halve(output.size));
    soft.forEach((level) => level.resize(halve(output.size)));
  }
  const [tx, ty] = half.texelSize;
  softBlur[0].set({ blur: { step: [tx * SOFT_SPREAD, 0] } });
  softBlur[1].set({ blur: { step: [0, ty * SOFT_SPREAD] } });
}

/** The text's world size: the font size, shrunk until the widest line fits the rest view. */
function textSize(sheet: TextSheet, aspect: number): [number, number] {
  const width = viewHeight(REST_DISTANCE) * aspect;
  const linesWide = sheet.width * sheet.aspect * sheet.rows;
  const font = Math.min(FONT, (FIT * width) / linesWide);
  return [font * sheet.aspect * sheet.rows, font * sheet.rows];
}

function render(stage: Stage, time: number, eye: readonly [number, number, number]): void {
  const { gpu, output, scene, back, behind, lit, image, half, soft, shadow, sheet } = stage;
  frame(gpu, (current) => {
    const [width, height] = output.size;
    const camera = viewProjection([width, height], eye);
    const model = floating(time, knotScale(width / height));
    stage.text.set({
      text: { viewProjection: camera, size: textSize(sheet, width / height), depth: TEXT_DEPTH, lift: LIFT },
    });
    stage.ground.set({
      ground: {
        viewProjection: camera,
        height: GROUND,
        reach: SHADOW_REACH,
        extent: GROUND_EXTENT,
        opacity: SHADOW_OPACITY,
      },
    });
    stage.silhouette.set({ silhouette: { viewProjection: topDown(SHADOW_REACH, 20, 40), model } });
    const lens = { viewProjection: camera, model, eye, light: LIGHT, ...GLASS };
    stage.glassBack.set({ glass: { ...lens, thickness: BACK, side: -1 } });
    stage.glass.set({ glass: { ...lens, thickness: FRONT, side: 1 } });

    current.pass({ target: shadow.raw, clear: [0, 0, 0, 0] }, (pass) => pass.draw(stage.silhouette));
    current.pass({ target: shadow.mid }, (pass) => pass.draw(stage.shrinkMid));
    current.pass({ target: shadow.low[0] }, (pass) => pass.draw(stage.shrinkLow));
    for (let round = 0; round < SHADOW_ROUNDS; round++) {
      current.pass({ target: shadow.low[1] }, (pass) => pass.draw(stage.shadowBlur[0]));
      current.pass({ target: shadow.low[0] }, (pass) => pass.draw(stage.shadowBlur[1]));
    }
    current.pass({ target: scene, clear: [BACKGROUND, BACKGROUND, BACKGROUND, 1] }, (pass) => {
      pass.draw(stage.text);
      pass.draw(stage.ground);
    });
    current.pass({ target: back, clear: [0, 0, 0, 0] }, (pass) => pass.draw(stage.glassBack));
    current.pass({ target: behind }, (pass) => pass.draw(stage.compositeBack));
    current.pass({ target: lit, clear: [0, 0, 0, 0] }, (pass) => pass.draw(stage.glass));
    current.pass({ target: image }, (pass) => pass.draw(stage.composite));
    current.pass({ target: half }, (pass) => pass.draw(stage.downHalf));
    current.pass({ target: soft[0] }, (pass) => pass.draw(stage.softBlur[0]));
    current.pass({ target: soft[1] }, (pass) => pass.draw(stage.softBlur[1]));
    current.pass({ target: output }, (pass) => pass.draw(stage.present));
  });
}
