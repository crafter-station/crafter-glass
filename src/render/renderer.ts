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
import { createRig, floating, GROUND, knotScale, REST, TEXT_DEPTH, type Pointer } from "../scene";
import { linear, type Look } from "../state/look";
import type { Store } from "../state/store";
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

const REST_DISTANCE = REST - TEXT_DEPTH;
const FIT = 0.92;
const SHADOW_REACH = 8;
const SHADOW_SIZE = 128;
const SHADOW_LOW = 32;
const SHADOW_ROUNDS = 2;
const SHADOW_SPREAD = 2;
const GROUND_EXTENT = 60;
const SOFT_SPREAD = 2.5;
const LIGHT = [20, 20, 10] as const;
const FALLOFF = 1;
const FLOOR = 0.6;

type Size = readonly [number, number];

export interface Options {
  readonly look: Store<Look>;
}

export interface Renderer {
  readonly ready: Promise<void>;
  point(pointer: Pointer): void;
  reshape(mesh: KnotMesh): Promise<void>;
  words(lines: readonly string[]): Promise<void>;
  dispose(): void;
}

interface Knot {
  readonly thickness: number;
  readonly geometry: ReturnType<typeof geometry>;
  readonly silhouette: Draw;
  readonly glassBack: Draw;
  readonly glass: Draw;
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
  readonly clamp: GPUSampler;
  readonly text: Draw;
  readonly ground: Draw;
  readonly compositeBack: Effect;
  readonly composite: Effect;
  readonly shrinkMid: Effect;
  readonly shrinkLow: Effect;
  readonly shadowBlur: readonly [Effect, Effect];
  readonly downHalf: Effect;
  readonly softBlur: readonly [Effect, Effect];
  readonly present: Effect;
  sheet: TextSheet;
  knot: Knot;
}

const halve = ([width, height]: Size): Size => [Math.max(1, width >> 1), Math.max(1, height >> 1)];

function createKnot(gpu: Gpu, mesh: KnotMesh, stage: Pick<Stage, "scene" | "behind" | "clamp">): Knot {
  const shape = geometry(gpu, {
    buffers: [
      { data: mesh.positions, attributes: { position: "float32x3" } },
      { data: mesh.normals, attributes: { normal: "float32x3" } },
      { data: mesh.cores, attributes: { core: "float32x3" } },
      { data: mesh.occlusion, attributes: { occlusion: "float32" } },
    ],
    indices: mesh.indices,
  });
  return {
    thickness: mesh.thickness,
    geometry: shape,
    silhouette: draw(gpu, {
      shader: silhouetteWgsl,
      geometry: shape,
      depth: false,
      cull: "none",
      label: "silhouette",
    }),
    glassBack: draw(gpu, {
      shader: glassWgsl,
      geometry: shape,
      cull: "front",
      label: "glass-back",
      set: { scene: stage.scene, sceneSampler: stage.clamp },
    }),
    glass: draw(gpu, {
      shader: glassWgsl,
      geometry: shape,
      cull: "back",
      label: "glass",
      set: { scene: stage.behind, sceneSampler: stage.clamp },
    }),
  };
}

const compileKnot = (knot: Knot, stage: Pick<Stage, "shadow" | "back" | "lit">) =>
  Promise.all([
    knot.silhouette.compile(stage.shadow.raw),
    knot.glassBack.compile(stage.back),
    knot.glass.compile(stage.lit),
  ]);

export function createRenderer(
  canvas: HTMLCanvasElement,
  mesh: Promise<KnotMesh>,
  options: Options,
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
    rig.step(dt, pointer, options.look.get().follow);
    render(stage, time, rig.eye, options.look.get());
    request = requestAnimationFrame(tick);
  };

  const start = async () => {
    gpu = await init();
    if (disposed) return gpu.dispose();
    const [first, sheet] = await Promise.all([mesh, createTextSheet(gpu, [options.look.get().text])]);
    if (disposed) return;
    const output = surface(gpu, canvas, { dpr: [1, 2] });
    const screen = (label: string, msaa = false) =>
      target(gpu!, { size: output.size, format: "rgba16float", msaa, depth: msaa, label });
    const scene = screen("scene");
    const back = screen("back", true);
    const behind = screen("behind");
    const lit = screen("lit", true);
    const image = screen("image");
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
    const knot = createKnot(gpu, first, { scene, behind, clamp });
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
      set: { sharp: image, soft: soft[1], presentSampler: clamp },
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
      clamp,
      text,
      ground,
      compositeBack,
      composite,
      shrinkMid,
      shrinkLow,
      shadowBlur,
      downHalf,
      softBlur,
      present,
      sheet,
      knot,
    };
    fit(current);
    await Promise.all([
      text.compile(scene),
      ground.compile(scene),
      compileKnot(knot, current),
      compositeBack.compile(behind),
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
    async reshape(next) {
      await ready;
      if (!stage || !gpu) return;
      const knot = createKnot(gpu, next, stage);
      await compileKnot(knot, stage);
      if (disposed) return knot.geometry.destroy();
      const old = stage.knot;
      stage.knot = knot;
      old.geometry.destroy();
    },
    async words(lines) {
      await ready;
      if (!stage || !gpu) return;
      const sheet = await createTextSheet(gpu, lines);
      if (disposed) return sheet.destroy();
      const old = stage.sheet;
      stage.sheet = sheet;
      stage.text.set({ glyphs: sheet.texture });
      old.destroy();
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
    [scene, back, behind, lit, image].forEach((level) => level.resize(output.size));
    [half, ...soft].forEach((level) => level.resize(halve(output.size)));
  }
  const [tx, ty] = half.texelSize;
  softBlur[0].set({ blur: { step: [tx * SOFT_SPREAD, 0] } });
  softBlur[1].set({ blur: { step: [0, ty * SOFT_SPREAD] } });
}

/** The words' world size: the font size, shrunk until the widest line fits the rest view. */
function textSize(sheet: TextSheet, aspect: number, look: Look): [number, number] {
  const width = viewHeight(REST_DISTANCE, look.fov) * aspect;
  const linesWide = sheet.width * sheet.aspect * sheet.rows;
  const font = Math.min(look.font, (FIT * width) / linesWide);
  return [font * sheet.aspect * sheet.rows, font * sheet.rows];
}

function render(stage: Stage, time: number, eye: readonly [number, number, number], look: Look): void {
  const { gpu, output, scene, back, behind, lit, image, half, soft, shadow, sheet, knot } = stage;
  const background = linear(look.background);
  frame(gpu, (current) => {
    const [width, height] = output.size;
    const aspect = width / height;
    const camera = viewProjection([width, height], eye, look.fov);
    const model = floating(time, knotScale(aspect, look.fov, look.size), look.float, look.sway);
    const tube = look.thickness / knot.thickness;
    stage.text.set({
      text: {
        viewProjection: camera,
        size: textSize(sheet, aspect, look),
        depth: TEXT_DEPTH,
        lift: look.lift,
        ink: linear(look.ink),
        pad: 0,
      },
    });
    stage.ground.set({
      ground: {
        viewProjection: camera,
        height: GROUND,
        reach: SHADOW_REACH,
        extent: GROUND_EXTENT,
        opacity: look.shadow,
      },
    });
    knot.silhouette.set({ silhouette: { viewProjection: topDown(SHADOW_REACH, 20, 40), model, tube } });
    const lens = {
      viewProjection: camera,
      model,
      eye,
      light: LIGHT,
      ior: look.ior,
      aberration: look.aberration,
      reflections: look.reflections,
      occlusion: look.occlusion,
      shine: look.shine,
      tube,
      panel: look.light,
    };
    knot.glassBack.set({ glass: { ...lens, thickness: look.back, side: -1 } });
    knot.glass.set({ glass: { ...lens, thickness: look.front, side: 1 } });
    stage.present.set({
      present: { focus: look.focus, falloff: FALLOFF, shade: look.shade, floor: FLOOR, blur: look.blur },
    });

    current.pass({ target: shadow.raw, clear: [0, 0, 0, 0] }, (pass) => pass.draw(knot.silhouette));
    current.pass({ target: shadow.mid }, (pass) => pass.draw(stage.shrinkMid));
    current.pass({ target: shadow.low[0] }, (pass) => pass.draw(stage.shrinkLow));
    for (let round = 0; round < SHADOW_ROUNDS; round++) {
      current.pass({ target: shadow.low[1] }, (pass) => pass.draw(stage.shadowBlur[0]));
      current.pass({ target: shadow.low[0] }, (pass) => pass.draw(stage.shadowBlur[1]));
    }
    current.pass({ target: scene, clear: [...background, 1] }, (pass) => {
      pass.draw(stage.text);
      pass.draw(stage.ground);
    });
    current.pass({ target: back, clear: [0, 0, 0, 0] }, (pass) => pass.draw(knot.glassBack));
    current.pass({ target: behind }, (pass) => pass.draw(stage.compositeBack));
    current.pass({ target: lit, clear: [0, 0, 0, 0] }, (pass) => pass.draw(knot.glass));
    current.pass({ target: image }, (pass) => pass.draw(stage.composite));
    current.pass({ target: half }, (pass) => pass.draw(stage.downHalf));
    current.pass({ target: soft[0] }, (pass) => pass.draw(stage.softBlur[0]));
    current.pass({ target: soft[1] }, (pass) => pass.draw(stage.softBlur[1]));
    current.pass({ target: output }, (pass) => pass.draw(stage.present));
  });
}
