import type { Shape } from "./knot";
import { createBuilder } from "./knot/builder";
import { createRenderer } from "./render/renderer";
import { load, save } from "./state/saved";
import { createStore } from "./state/store";
import { createDrawer } from "./ui/drawer";
import "./styles.css";

const SETTLE = 400;
const RETYPE = 200;

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const poster = document.querySelector<HTMLElement>("#poster")!;
const look = createStore(load());
const builder = createBuilder();
const shapeOf = (thickness: number): Shape => ({ facets: 0, twist: 0, ends: "round", thickness });
const renderer = createRenderer(canvas, builder.build(shapeOf(look.get().thickness)), { look });
createDrawer({ look });

let built = look.get().thickness;
let building = false;
const reshape = async () => {
  if (building) return;
  const wanted = look.get().thickness;
  if (wanted === built) return;
  building = true;
  built = wanted;
  await renderer.reshape(await builder.build(shapeOf(wanted)));
  building = false;
  reshape();
};

let written = look.get().text;
let retyping = 0;
const rewrite = () => {
  clearTimeout(retyping);
  retyping = window.setTimeout(async () => {
    const wanted = look.get().text;
    if (wanted === written) return;
    written = wanted;
    await renderer.words([wanted]);
    rewrite();
  }, RETYPE);
};

let settling = 0;
const apply = () => {
  const current = look.get();
  document.body.style.background = current.background;
  poster.querySelector("h1")!.textContent = current.text;
  clearTimeout(settling);
  settling = window.setTimeout(() => save(current), SETTLE);
  reshape();
  rewrite();
};
look.subscribe(apply);
apply();

window.addEventListener("pointermove", (event) =>
  renderer.point({ x: (event.clientX / innerWidth) * 2 - 1, y: 1 - (event.clientY / innerHeight) * 2 }),
);

renderer.ready.catch((error: unknown) => {
  poster.hidden = false;
  console.error(error);
});
