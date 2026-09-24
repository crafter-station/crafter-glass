# crafter-glass

![The Crafter Station mark as thick glass, floating in front of its name](.github/hero.jpg)

The Crafter Station mark as a thick glass knot, floating in front of its name and refracting it,
rendered on WebGPU with [vgpu](https://vgpu.sh) as the only rendering dependency. Move the pointer
to look around it.

```bash
npm install
npm run dev
npm run build
```

Needs a browser with WebGPU: current Chrome, Edge and Safari 26 on desktop, Safari on iOS 26,
Chrome on Android. Without it the page shows the name and says so.

## How it works

- The tubes come from [crafter-knot](https://github.com/crafter-station/crafter-knot): the mark's
  outline fitted as B-spline strokes and swept into a watertight mesh in a worker.
- The name is drawn once with Inter on a 4096-pixel canvas, mipmapped, and stood ten units behind
  the knot, so the camera moves it in perspective and the glass refracts it.
- The glass refracts each pixel into the tube, across it and out through the far wall, per colour
  channel, then adds Fresnel reflections of a bright studio and the sheen of the far wall. Contact
  between tubes is darkened from baked occlusion.
- A top-down silhouette of the knot, blurred at 32 pixels, is the contact shadow on the floor. The
  present pass blends in a half-resolution blur toward the top and bottom of the frame, tilt-shift
  style.
- The camera is damped toward a point the pointer chooses, and the knot bobs and sways on its own.

After the pmndrs [router-transitions](https://pmndrs.github.io/examples/router-transitions/)
example.
