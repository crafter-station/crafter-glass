import { createBuilder } from "./knot/builder";
import { createRenderer } from "./render/renderer";
import "./styles.css";

const LINES = ["/ship-it"];
const THICKNESS = 2.2;

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const poster = document.querySelector<HTMLElement>("#poster")!;
const mesh = createBuilder().build({ facets: 0, twist: 0, ends: "round", thickness: THICKNESS });
const renderer = createRenderer(canvas, mesh, LINES);

window.addEventListener("pointermove", (event) =>
  renderer.point({ x: (event.clientX / innerWidth) * 2 - 1, y: 1 - (event.clientY / innerHeight) * 2 }),
);

renderer.ready.catch((error: unknown) => {
  poster.hidden = false;
  console.error(error);
});
