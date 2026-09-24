import { effect, frame, sampler, target, texture, type Gpu, type Texture } from "vgpu";
import mipWgsl from "./render/shaders/mip.wgsl";

const WIDTH = 4096;
const HEIGHT = 2048;
const FONT = 720;
const LINE = 1.15;
const CAP = 0.727;
const TRACKING = -0.025;
const LEVELS = 5;
const FONT_WAIT = 2500;

export interface TextSheet {
  readonly texture: Texture;
  /** Canvas width over height. */
  readonly aspect: number;
  /** Canvas height in font sizes: the quad is this tall for a font size of one unit. */
  readonly rows: number;
  /** The widest line, as a share of the canvas width. */
  readonly width: number;
  destroy(): void;
}

async function fonts(family: string): Promise<void> {
  const wait = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT));
  await Promise.race([document.fonts.load(`400 ${FONT}px ${family}`).then(() => undefined), wait]);
}

export async function createTextSheet(gpu: Gpu, lines: readonly string[]): Promise<TextSheet> {
  await fonts("Inter").catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d")!;
  context.font = `400 ${FONT}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.letterSpacing = `${TRACKING * FONT}px`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  const block = CAP * FONT + (lines.length - 1) * LINE * FONT;
  const top = (HEIGHT - block) / 2;
  lines.forEach((line, i) => context.fillText(line, WIDTH / 2, top + CAP * FONT + i * LINE * FONT));
  const width = Math.max(...lines.map((line) => context.measureText(line).width)) / WIDTH;

  const sheet = texture(gpu, {
    kind: "2d",
    size: [WIDTH, HEIGHT],
    format: "rgba8unorm",
    mipLevelCount: LEVELS,
    usage: ["texture_binding", "copy_dst", "render_attachment"],
    label: "text",
  });
  gpu.gpu.queue.copyExternalImageToTexture({ source: canvas }, { texture: sheet.gpu }, [WIDTH, HEIGHT]);

  const linear = sampler(gpu, { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
  for (let level = 1; level < LEVELS; level++) {
    const size = [WIDTH >> level, HEIGHT >> level] as const;
    const smaller = target(gpu, { size, format: "rgba8unorm", label: `text-mip-${level}` });
    const shrink = effect(gpu, mipWgsl, {
      label: `text-mip-${level}`,
      set: { src: sheet, srcSampler: linear, mip: { level: level - 1 } },
    });
    await shrink.compile(smaller);
    frame(gpu, (current) => current.pass({ target: smaller }, (pass) => pass.draw(shrink)));
    const encoder = gpu.gpu.createCommandEncoder({ label: "text-mip" });
    encoder.copyTextureToTexture(
      { texture: smaller.color.gpu },
      { texture: sheet.gpu, mipLevel: level },
      size,
    );
    gpu.gpu.queue.submit([encoder.finish()]);
    await gpu.gpu.queue.onSubmittedWorkDone();
    smaller.color.destroy();
  }

  return {
    texture: sheet,
    aspect: WIDTH / HEIGHT,
    rows: HEIGHT / FONT,
    width,
    destroy: () => sheet.destroy(),
  };
}
