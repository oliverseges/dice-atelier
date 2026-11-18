# Dice Atelier implementation plan

## Outcome

Build a polished, responsive, local-first 3D dice workshop and physics playground and publish it as a static GitHub Pages site at `https://dice.oeng.dev/`.

## Approved product decisions

- Use TypeScript, Vite, Three.js, and cannon-es; keep the interface framework-free.
- Dice are authored, saved, loaded, and deleted locally. There are no accounts, server-side saves, paid services, or runtime external assets.
- Standard dice are prominent: d4, d6, d8, d10, d12, d20, and d100. Curated d2, d3, d5, d7, d14, d16, d24, and d30 are available under additional shapes.
- Per-face display labels are independent from numeric scoring values. Labels can be Arabic/Roman presets or user-authored text/symbols.
- Dice have meaningful visual controls for body material, transparency, iridescence, color, and engraved/embossed/gilded face treatments. Three selectable interface themes and two throwing surfaces are provided.
- Throwing uses actual rigid-body physics. Results come from the resting face normal, not a random result selected independently of the animation.
- A hand mixes saved dice and quantities. Each group has a multiplier and one-time offset; optional hand-wide modifiers apply after group totals:
  `total = sum(groupSubtotal * groupMultiplier + groupOffset) * handMultiplier + handOffset`.
- Throws snapshot the hand before simulation. A cocked or timed-out result is reported as unsettled, never replaced with an invented result.
- Validate versioned localStorage data, report storage/WebGL failures, cap dice and physics work, support keyboard use and reduced motion, and clean up Three.js resources.
- Deploy from GitHub Actions to Pages at the root path with `public/CNAME` set to `dice.oeng.dev`.
- The play view is a full-screen immersive table with a compact floating hand panel, die/quantity picker, optional group and hand modifiers, and both a Throw button and pointer-drag flicking. Individual die sizes are configurable and saved.
- A subtle left arrow animates the camera to the design table; advanced face/material controls stay in that view.
- Coverage is a release gate: 100% statements, branches, functions, and lines across all authored `src/**/*.ts`, with no exclusions or coverage-ignore pragmas.

## Representation notes to disclose in the UI and README

- d4, d6, d8, d10, d12, d20, d24, and d30 have convex rigid-body geometry. d10 uses a ten-kite pentagonal trapezohedron; d24/d30 use 12-/15-sided bipyramids with exactly 24/30 faces. d100 rolls two physical d10s (tens and units) and applies the combined 00–99 mapping, with 00 + 0 = 100.
- d2, d3, d5, d7, d14, and d16 use disclosed repeated outcomes on convex tetrahedral, cubical, or icosahedral solids. Every advertised outcome has at least one reachable physical face, although repeated outcomes and irregular geometry can bias probability.
- d4 is evaluated by its unique downward-facing bottom face; the matching result is printed at its opposite upper vertex on the three visible neighboring faces.
- Engraving and embossing are rendered as light-reactive face relief/decals rather than carved mesh topology.
- Physical outcome probabilities have not been statistically calibrated; repeated-outcome and non-regular solids can be biased.

## Implementation and verification log

- 2026-11-18: Repository instructions checked; the initial repository contains only its README and MIT license. The separate approved plan artifact was not readable in this session, so this document reconstructs the approved scope and decisions supplied with the assignment.
- 2026-11-18: Domain provisioning was completed by the coordinator. Keep the Vite base at `/`; do not change DNS or Pages API settings.
- 2026-11-18: Implemented the immersive play/design views, configurable die size, procedural environment/lighting, light-reactive face relief, and pointer-drag throwing. Desktop and mobile play/design layouts were browser-checked. A saved custom d6 retained size, labels, and independent scores after reload; real browser throws confirmed mouse flicking, d4 bottom-face scoring, and group-before-hand modifier order.
- 2026-11-18: Corrected d24/d30 to exact 24-/30-face bipyramids and added outcome-reachability plus d4 bottom-face tests. The d4 visible labels repeat each outcome at its opposite corner. A d100 physics smoke test exposed stable edge-cocked d10 bipyramids; replaced them with a 10-face pentagonal trapezohedron whose kite faces derive from a pentagonal antiprism. Normal-motion browser throws now settle from physical tens/units dice; a custom d100 mapping produced `N11 → 64` from its actual combined outcome. Theme selection and the two throwing surfaces were also browser-checked.
- 2026-11-18: The full suite passes: 143 tests across 7 files and 100% coverage across all authored TypeScript (`src/**/*.ts`) — 1,402/1,402 statements, 573/573 branches, 222/222 functions, and 1,229/1,229 lines, with no coverage exclusions or pragmas. `npm run typecheck` and `npm run build` pass; Vite reports a 611.61 kB minified JavaScript bundle (161.09 kB gzip). Desktop/mobile browser checks cover save/reload, size, flicking, modifier order, d4 orientation, all themes/surfaces, and default plus custom d100 physical outcomes. Mobile design preview is scaled to remain unobscured beside the editor. Final screenshots are in `output/playwright/`.
- 2026-11-18: Commit `db4eb6b08559d2a30be8d71656ea39ef3c16512e` was pushed to `main`; Pages workflow run [44338610337](https://github.com/oliverseges/dice-atelier/actions/runs/44338610337) completed successfully. `http://dice.oeng.dev/` returns 200, and the deployed HTML plus JS (`611,613` bytes) and CSS (`23,361` bytes) were fetched successfully. HTTPS currently fails certificate hostname validation (`SEC_E_WRONG_PRINCIPAL`); Pages reports `https_enforced: false` and an HTTP canonical URL. DNS and Pages settings were left unchanged; enable HTTPS only after GitHub issues a valid certificate.
