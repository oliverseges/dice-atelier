# Dice Atelier

A beautiful local-first 3D dice workshop and physics playground. Design a die, save it in your browser, build a mixed hand, and let real rigid-body motion decide the face-up results.

**Live site:** [dice.oeng.dev](https://dice.oeng.dev/) · **Repository:** [oliverseges/dice-atelier](https://github.com/oliverseges/dice-atelier)

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

The local Vite server prints its address (usually `http://localhost:5173`). Useful checks:

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

`npm test` enforces 100% statement, branch, function, and line coverage across every `src/**/*.ts` file. Every push to `main` runs the tests and type check, builds the static site, and deploys `dist/` to GitHub Pages through `.github/workflows/deploy.yml`. The Vite base path is `/`, and `public/CNAME` declares `dice.oeng.dev`.

## Make and roll

- The main view is a full-screen 3D throwing table with a compact hand panel. Pick a standard d4, d6, d8, d10, d12, d20, or d100, set a quantity, and add dice without saving them first. Select a saved design for custom dice; open **More shapes** on the design table for curated d2, d3, d5, d7, d14, d16, d24, and d30.
- Click **Throw**, or drag the table and release to flick the hand, including before the first throw. Added dice appear resting on the table; after a throw, you can also grab an individual die and flick it again. Use the subtle left arrow to move the camera to the design table and the return arrow to come back.
- Set a die's size from 60% to 140%, along with a name, color, porcelain/satin-metal/crystal/enamel body, transparency, iridescence, and a gilded, engraved, or embossed face treatment. Size and other design choices are saved with the die. Finish & light controls are progressive disclosure.
- Face labels and score values are separate. Arabic and Roman presets are available; custom mappings accept one `label|score` pair per line. A d100 mapping has 100 lines. Labels are plain text and limited to eight characters; scores may be negative or non-integer.
- Save a die, select it, and add one or more copies to a hand. Group multipliers (×1, ×2, ×4) and offsets (+0, +2, −1) apply once per group. The optional hand modifier applies after all group totals:

  ```text
  total = sum(groupSubtotal × groupMultiplier + groupOffset) × handMultiplier + handOffset
  ```

- Find the surface and theme settings at the design table. Switch between the clean cloud surface and a procedural tabletop; choose Ivory & brass, Studio color, or Forest atelier interface themes. Group and hand modifiers are optional disclosures rather than always-open controls.
- A throw uses a snapshot of the hand and modifiers at launch. Each result is evaluated from the world-space normal of the actual resting face. A die that has not settled within ten seconds is reported as cocked with no score rather than assigned a made-up result.

## Shape and physics notes

| Shape | Physical representation |
| --- | --- |
| d4 | Four-face tetrahedron. Each value is repeated at the opposite vertex on its three adjacent faces; the result is read from the unique bottom face, matching the visible value at the upper corner. |
| d6 | Six-face cube |
| d8 | Eight-face octahedron |
| d10 | Convex ten-face pentagonal trapezohedron with ten kite faces; physical probability is not calibrated |
| d12 | Twelve-face dodecahedron derived from the icosahedron dual |
| d20 | Twenty-face icosahedron |
| d100 | Two physical d10s: tens (00, 10, …, 90) and units (0–9). `00 + 0` is 100. Its 100 custom labels and scores apply to the combined percentile outcome and are shown in the result ledger. |
| d2, d3 | Tetrahedral body with repeated outcomes |
| d5 | Cubical body with a repeated outcome |
| d7, d14, d16 | Icosahedral body with repeated outcomes |
| d24 | Convex 12-sided bipyramid, with 24 physical faces |
| d30 | Convex 15-sided bipyramid, with 30 physical faces |

These are finite, named choices—not an arbitrary shape or dice-count generator. Every advertised outcome has at least one physical face, including all 24 d24 outcomes and all 30 d30 outcomes. Repeated-outcome solids and the non-regular d24/d30 bipyramids can have uneven probabilities; the physical dice have not been statistically calibrated for fairness. Results are physics-derived, not randomly selected after the animation.

The engraved and embossed appearances are light-reactive face relief/decals, not carved mesh topology. Visual edge bevels soften reflections; collision detection still uses the authoritative un-beveled convex solid. Body finish, transparency, iridescence, and high-contrast labels are rendered locally using a prefiltered studio reflection environment, clearcoat, and cast/contact shadows. The table grain and cloud surface are procedural; no runtime remote textures, fonts, or other assets are needed.

## Local-first privacy and limits

Saved dice and the optional interface theme stay in this browser's `localStorage`; they are not sent to a server. Clearing the browser's site data removes them. There are no accounts, analytics, backend services, or cloud saves. The versioned collection is validated before use; malformed or unsupported data is preserved and will not be silently overwritten. Storage and WebGL errors are shown in the interface.

A hand is limited to 30 logical dice and 30 physical bodies (a d100 occupies two). The renderer caps device pixel ratio at 1.5, uses a bounded physics timestep, and disposes rendered resources when the scene changes or the page closes. Keyboard-operable controls, live result announcements, and reduced-motion handling are included. Face treatments use light-reactive relief textures, not carved mesh topology; the studio environment, shadows, and tabletop surfaces are procedural, with no external runtime assets.

## References

- [Three.js documentation](https://threejs.org/docs/)
- [cannon-es documentation](https://pmndrs.github.io/cannon-es/)
- [Vite static deployment guide](https://vite.dev/guide/static-deploy.html)
