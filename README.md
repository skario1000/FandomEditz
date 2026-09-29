# EDITVERSE — Fandom Edit Studio

A browser video editor built for fandom edits: microwave cuts, good zooms, spin
zooms, twixtor slow motion, velocity ramps, beat sync and MP4 export — no
timeline-ninja AE rig required.

Everything runs locally in the browser. Media never leaves the machine.

## Run it

```bash
cd specialized-fandom-video-editor
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # single-file dist/index.html
npm run build:docs # the same file, into ../docs — this is the site
npm run typecheck  # tsc --noEmit
npm test           # 70+ regression checks on the editing maths
```

## Put it online (free)

`npm run build:docs` writes **one self-contained `docs/index.html`** — no
server, no assets, no accounts. It has a relative base, so it runs from any
path. Three ways to host it, cheapest first:

1. **GitHub Pages** — the repo is public and `docs/` is already committed to
   `main`. Turn it on at
   `github.com/skario1000/FandomEditz/settings/pages` → Source *Deploy from a
   branch* → `main` + `/docs`. Live in about a minute at
   `https://skario1000.github.io/FandomEditz/`, free forever.
2. **Netlify Drop** — drag the `docs` folder onto
   `https://app.netlify.com/drop` and you get a `*.netlify.app` URL with no
   account at all.
3. **Nothing** — download `docs/index.html` and open it. It works offline, and
   the media never leaves the browser either way.

Re-deploying after a change is `npm run build:docs && git add -A && git commit
&& git push`.

## What's in the box

### Direct manipulation
Drag on the monitor to move a clip, drag a corner to zoom, drag outside the
frame to rotate, and use the wheel (or a trackpad pinch) to scale. The gizmo is
a real editor gizmo, not a readout: corner zoom is measured from the opposite
corner, so the frame scales around what you point at.

| Gesture | Result |
| --- | --- |
| Drag inside the frame | Pan (X/Y) |
| Drag a corner | Scale from the opposite corner |
| Drag outside the frame | Rotate |
| Wheel / pinch | Scale |
| `Shift` + wheel | Rotate 5° at a time |
| `Alt` while dragging | Bypass snapping |
| `[` / `]` | Rotate ∓1° (5° with `Shift`) |
| `,` / `.` | Zoom out / in |
| `0` | Reset the transform |

Dragging always writes the property the playhead is actually showing, so
animating and hand-tuning compose instead of fighting.

### One-click moves
Ten animated moves — push in, pull out, whip, crash, hero, dutch, spin 360,
orbit, zoom punch, breathe — that write real, editable keyframes instead of a
baked overlay. Open the curve editor afterwards and reshape them.

### Rotate, 3D and music reactivity
- **Spin Zoom** — a full 360° roll with the zoom, motion blur computed from the
  actual rotation, so the spin smears instead of stepping.
- **Dutch Zoom** — tip into a tilt and level out.
- **Orbit Zoom** — a pendulum swing that never quite settles.
- **3D Spin / Y-Spin** — flips the layer through its back face with correct
  face-on shading and a mirrored back side.
- **Snap Rotate, Tilt Rush, Barrel Roll, Spin Through** — rotation as a first
  class effect, not just a number in a box.
- **Bass Pump** — zoom, shake and glow driven by the low end of your track.
  The envelopes are analysed once from the decoded audio and shared by the
  preview, the meter and the export, and every clip samples the *source* time
  of the music under it, so the export matches the preview frame for frame.

## Layout

```
src/lib/        transform maths, moves, effects, audio analysis, AI director
src/components/ inspector, previews, gizmo, FX + beats tabs
src/gl/         WebGL renderer
src/store.ts    zustand state, history, presets
tests/          regression checks (npm test)
```

`src/lib/transform.ts` holds the geometry both the gizmo and the keyboard
shortcuts use, so a corner drag and the `[` key can never disagree.
