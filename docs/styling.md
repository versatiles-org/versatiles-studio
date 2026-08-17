# Styling

How Studio's CSS is organised, and the rules that keep it consistent as it grows. Read this before
adding a component.

The problem it solves is not ugly CSS — it is **drift**. With thirteen components and no shared
vocabulary, the codebase had reached nine near-identical small font sizes, four corner radii, three
different reds for the same error state, and the same token carrying two different fallback values in
two different files. None of that was a bad decision; each was a reasonable local choice made without
a way to see the others.

## Where things live

| File                        | Holds                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `src/lib/styles/tokens.css` | Every colour, type size, spacing step, radius and font stack       |
| `src/lib/styles/base.css`   | The reset, the focus ring, element defaults, and one utility class |
| `src/lib/styles/tokens.ts`  | Reading tokens from JavaScript, for MapLibre paint properties      |
| A component's `<style>`     | Everything true of that component only                             |

Both stylesheets are imported in `main.ts` before the application mounts, so tokens are always
defined by the time anything renders.

## The rules

**1. Components never write a raw value.** No hex colours, no `font-size: 0.72rem`, no
`border-radius: 4px`, no font stacks. Use a token; if none fits, add one — deliberately, once,
where everyone can see it.

**2. Never write `var(--token, fallback)`.** The fallback is only reachable when the token is
missing, which cannot happen. They are dead code that drifts: we carried `var(--ink-2, #667)` in one
file and `var(--ink-2, #66716f)` in another, so the "same" colour had two definitions.

**3. Focus is not yours to design.** `base.css` styles `:focus-visible` once for the whole
application. A component may set `outline-offset` when its control sits flush against an edge and the
ring would be clipped. It may not set the colour or the width.

**4. Colours that reach MapLibre go through `token()`.** Paint properties take strings, not CSS, so
`'line-color': 'var(--accent)'` does nothing. `styles/tokens.ts` reads the computed value. Without
it the map is the one surface a theme cannot reach — which is how the map background and the element
behind it ended up two different greys.

**5. Layout stays in the component.** Grid areas, flex direction, `min-width: 0` — these describe one
surface and belong with it. Only genuinely universal rules go in `base.css`.

These are enforced by `src/lib/styles/tokens.test.ts`, which runs with `npm test`. It fails with the
file and the offending value named. It checks colour, type size, radius, font stacks, fallbacks, the
focus ring and map colours — and nothing else, because a rule nobody can justify is a rule people
route around.

## The tokens

Each set is small and closed **on purpose**. That is the whole mechanism: picking from five type
sizes is faster than inventing a sixth, so the constraint holds itself up without anyone policing it.

| Set      | Tokens                                                                            |
| -------- | --------------------------------------------------------------------------------- |
| Colour   | `--ink`, `--ink-2`, `--rule`, `--surface`, `--chrome`, `--accent`, `--accent-ink` |
| Semantic | `--error`, `--error-bg`, `--error-rule`                                           |
| Map      | `--map-bg`, `--map-grid`, `--map-grid-halo`, `--map-feature`, `--float-bg`        |
| Type     | `--text-xs` `--text-sm` `--text-md` `--text-lg` `--text-xl`, `--text-mono-adjust` |
| Fonts    | `--font-ui`, `--font-mono`                                                        |
| Space    | `--space-1` … `--space-6`                                                         |
| Shape    | `--radius`, `--radius-lg`, `--shadow`, `--shadow-lg`, `--focus-width`             |

**Map colours are separate from the chrome palette**, even where the value is identical today. A grid
drawn over a dark basemap is a different decision from a focus ring, and collapsing them would mean
one of the two gets the wrong answer the first time either changes.

**`--text-mono-adjust` is not a step on the scale.** Monospace reads optically larger than the UI font
at the same nominal size, so inline `code` is nudged down relative to whatever surrounds it. It is a
font-metric correction, applied once in `base.css`.

## Utilities

There is exactly one: `.truncate`, for the one-line-with-an-ellipsis idiom that appeared verbatim in
seven places.

**The bar for a second is high.** A utility has to be remembered in the markup, which is a second
mechanism to hold in your head alongside scoped CSS. `min-width: 0` was a candidate and did not make
it — it is one declaration, it belongs beside the layout rules that make it necessary, and applying
it through markup at every level of a nesting chain would be easier to get wrong, not harder.

This is not a utility framework and should not become one. If a rule is true of one surface, it lives
in that surface's `<style>` block.

## Two layout rules worth knowing

**`min-width: 0` at every level of a shrinking chain.** Flex and grid children default to
`min-width: auto`, which resolves to their _content_ width — so one long path silently widens its
whole column and pushes the map off the screen. It has to be applied at every link; missing one
defeats all the others. This is the single most repeated rule in the codebase and the hardest to
diagnose from the symptom.

**Panes that scroll set `overscroll-behavior: contain`.** `base.css` stops the window itself
rubber-banding; without `contain`, reaching the end of a scrollable pane chains the scroll back up to
the document and starts it bouncing anyway.

## Adding a component

1. Write the markup and the layout in a scoped `<style>` block.
2. Reach for tokens for every colour, size, space and radius.
3. Do not style focus.
4. If a shrinking chain runs through it, put `min-width: 0` on every level.
5. Run `npm test` — the token tests will name anything raw.

## Dark theme

**It follows the operating system**, through one `@media (prefers-color-scheme: dark)` block in
`tokens.css` that redefines the colour tokens and nothing else. There is no in-app switch: a desktop
application that disagrees with the system it runs on is what users complain about, and an override
would need a preference to store and a settings surface to put it in, neither of which exists yet.

**No component rule belongs in that block.** That is what makes the theme one edit instead of
thirteen, and what stops the two themes drifting apart.

**It is not an inversion.** Dark surfaces make colours read lighter and less saturated, so the accent
and the error red are lifted rather than reused, and `--accent-ink` flips to dark because the accent
it sits on is now the lighter of the two. Panels stay lighter than the application background, the
same way round as in the light theme, so depth reads the same.

`tokens.test.ts` checks that **every colour exists in both themes**. The failure it prevents is
quiet: add a colour to `:root`, forget the dark block, and it keeps its light value on a dark ground
— often still readable enough in a screenshot to pass review, and wrong.

### The map is the part that does not come free

Chrome colours follow the theme because they are `var()` references, re-resolved by the browser. Map
colours are **values copied into a layer when it is added**, so a layer created under the light theme
keeps its light colours forever.

`src/lib/map/theme.ts` re-applies them. Layers declare what they are through
`metadata['studio:role']` — `background`, `grid-line`, `grid-label`, `container-feature` — rather
than being recognised by their id, because ids encode where a layer came from and would break this
whenever a naming scheme changed elsewhere. **A new themed map layer must be tagged with `role()`, or
it will not follow the theme.** `MapCanvas` triggers the repaint by reading `theme.dark` from
`styles/theme.svelte.ts`.

`index.html` carries the only styling outside `src/lib/styles`: a background colour for each theme,
because the stylesheets arrive with the JS bundle and the window would otherwise paint white for a
frame on every launch.

## Known: `--rule` is a faint border

`--rule` sits at 1.35:1 against `--surface` in both themes — below the 3:1 WCAG asks of a boundary
that identifies a control. It is deliberate as a separator and fine there. Where it borders an input,
the control is also distinguished by its fill, so it is not a failure — but it is worth revisiting if
the borders ever become the only cue. Both themes are equally affected; this predates the dark
theme.
