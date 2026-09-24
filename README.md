# crafter-glass

![The Crafter Station mark as thick glass, floating in front of /ship](.github/hero.jpg)

The Crafter Station mark as a thick glass knot, floating in front of `/ship` and refracting it,
rendered on WebGPU with [vgpu](https://vgpu.sh) as the only rendering dependency. Move the pointer
to look around it.

The handle on the right edge opens a drawer with every property: the words and their ink, size and
lift; the tube width and the knot's size; the glass (refraction, dispersion, the depth of the front
and back passes, reflections, the light panel, the highlight, contact shade); the background,
shadow and lens; float, sway and how far the camera follows the pointer; and the tilt-shift blur.
The whole state is live JSON at the bottom, kept between visits; **Reset** returns to the default.

```bash
npm install
npm run dev
npm run build
```

Needs a browser with WebGPU: current Chrome, Edge and Safari 26 on desktop, Safari on iOS 26,
Chrome on Android. Without it the page shows the words and says so.

## How it works

- The tubes come from [crafter-knot](https://github.com/crafter-station/crafter-knot): the mark's
  outline fitted as B-spline strokes and swept into a watertight mesh in a worker.
- The words are drawn once with Inter on a 4096-pixel canvas, mipmapped, and stood ten units
  behind the knot, so the camera moves it in perspective and the glass refracts it.
- The glass is two passes, as the transmission material does it: the back faces refract the scene
  behind them, then the front faces refract that result, so tubes show through tubes. Each pass
  spreads the refraction over six samples with a different index per colour channel, which is
  where the fringes come from, and adds Fresnel reflections of a bright sky over a dark street.
  Contact between tubes is darkened from baked occlusion.
- A top-down silhouette of the knot, blurred at 32 pixels, is the contact shadow on the floor. The
  present pass blends in a half-resolution blur toward the top and bottom of the frame, tilt-shift
  style.
- The camera is damped toward a point the pointer chooses, and the knot bobs and sways on its own.

After the pmndrs [router-transitions](https://pmndrs.github.io/examples/router-transitions/)
example.
