# Styling

How Studio's CSS is organised, and the rules that keep it consistent as it grows. Read this before
adding a component.

The problem it solves is not ugly CSS - it is **drift**. With thirteen components and no shared
vocabulary, the codebase had reached nine near-identical small font sizes, four corner radii, three
different reds for the same error state, and the same token carrying two different fallback values in
two different files. None of that was a bad decision; each was a reasonable local choice made without
a way to see the others.

## Where things live

| File                        | Holds                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| `src/lib/styles/tokens.css` | Every colour, type size, spacing step, radius and font stack             |
| `src/lib/styles/base.css`   | The reset, the focus ring, element defaults, and the four shared classes |
| `src/lib/styles/tokens.ts`  | Reading tokens from JavaScript, for MapLibre paint properties            |
| A component's `<style>`     | Everything true of that component only                                   |

Both stylesheets are imported by each page's entry point - `main.ts` and `landing.ts` - before the application mounts, so tokens are always defined by the time anything renders.

## The rules

```css
/* not this */                          /* this */
.chip { … }                             .chip {
.chip.on { … }                            …
.chip:hover { … }                         &.on { … }
                                          &:hover { … }
                                        }
```

```css
.entry {
  .detail { … }    /* a descendant of .entry */
  & + li { … }     /* the li after .entry */
}
```

**1. Components never write a raw value.** No hex colours, no `font-size: 0.72rem`, no `border-radius: 4px`, no font stacks. Use a token; if none fits, add one - deliberately, once, where everyone can see it. This includes the `font` shorthand: write `font-size` and `font-family` separately, or nine raw sizes hide behind `font: 0.75rem …` where the checks cannot see them.

**2. Never write `var(--token, fallback)`.** The fallback is only reachable when the token is missing, which cannot happen. They are dead code that drifts: we carried `var(--ink-2, #667)` in one file and `var(--ink-2, #66716f)` in another, so the "same" colour had two definitions.

**3. Focus is not yours to design.** `base.css` styles `:focus-visible` once for the whole application. A component may set `outline-offset` when its control sits flush against an edge and the ring would be clipped. It may not set the colour or the width.

## The tokens

| Set      | Tokens                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour   | `--ink`, `--ink-2`, `--rule`, `--surface`, `--chrome`, `--accent`, `--accent-ink`                                                               |
| Semantic | `--error`, `--error-bg`, `--scrim` - behind a modal                                                                                             |
| Map      | `--map-bg`, `--map-grid`, `--map-grid-halo`, `--map-feature`, `--map-pending`, `--map-label`, `--map-crop-dim`, `--map-crop-edge`, `--float-bg` |
| Pipeline | `--pipe`, `--pipe-width` - the chain's connectors and its node outlines are one line, so they are one pair of tokens                            |
| Type     | `--text-xs` 12 · `--text-sm` 13 · `--text-md` 14 (default) · `--text-lg` 17 · `--text-xl` 22, plus `--text-mono-adjust`                         |
| Syntax   | `--vpl-value` - operation names take the accent; only values need a colour of their own                                                         |
| Fonts    | `--font-ui`, `--font-mono`                                                                                                                      |
| Space    | `--space-1` … `--space-6`                                                                                                                       |
| Shape    | `--radius`, `--radius-lg`, `--shadow`, `--focus-width`                                                                                          |

Each set is small and closed **on purpose**. That is the whole mechanism: picking from five type sizes is faster than inventing a sixth, so the constraint holds itself up without anyone policing it.

**Map colours are separate from the chrome palette**, even where the value is identical today. A grid drawn over a dark basemap is a different decision from a focus ring, and collapsing them would mean one of the two gets the wrong answer the first time either changes.

## Type: three rules

| Size                      | For                                           |
| ------------------------- | --------------------------------------------- |
| _(none)_                  | ordinary UI text - inherits `--text-md`, 14px |
| `--text-sm`               | dense data displays: JSON, popups, metadata   |
| `--text-xs`               | labels and counts in the left pane            |
| `--text-lg` / `--text-xl` | panel emphasis; the launcher                  |

That is why no component declares `--font-ui`: if you find yourself reaching for it, the text is already in the right face and the declaration is noise.

**`--text-mono-adjust` is not a step on the scale.** Monospace reads optically larger than the UI font at the same nominal size, so inline `code` is nudged down relative to whatever surrounds it. It is a font-metric correction, applied once in `base.css`.

## What base.css already gives you

| Element                                 | You get                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `button`, `input`, `select`, `textarea` | `font: inherit`, `color: inherit`                                     |
| `input`, `select`, `textarea`           | background, border, radius, padding - a themed face                   |
| `button`                                | cursor, the disabled colour, and **no box at all**                    |
| `.button`                               | the box, on request: background, border, radius and a compact padding |
| `ul`, `ol`                              | no markers, no margin, no padding                                     |
| `code`, `kbd`, `samp`                   | the monospace stack and its optical size correction                   |
| anything focusable                      | the focus ring                                                        |

Do not write these again - they are done once, for everything:

## Shared classes

Four, each applying to elements that have nothing else in common:

This is not a utility framework and should not become one. If a rule is true of one surface, it lives in that surface's `<style>` block.

## Two layout rules worth knowing

**Panes that scroll set `overscroll-behavior: contain`.** `base.css` stops the window itself rubber-banding; without `contain`, reaching the end of a scrollable pane chains the scroll back up to the document and starts it bouncing anyway.

## Adding a component

1. Write the markup and the layout in a scoped `<style>` block. 2. Reach for tokens for every colour, size, space and radius. 3. Do not style focus. 4. If a shrinking chain runs through it, put `min-width: 0` on every level. 5. Run `npm test` - the token tests will name anything raw.

## Dark theme

**It follows the operating system**, through one `@media (prefers-color-scheme: dark)` block in `tokens.css` that redefines the colour tokens and nothing else. There is no in-app switch: a desktop application that disagrees with the system it runs on is what users complain about, and an override would need a preference to store and a settings surface to put it in, neither of which exists yet.

**No component rule belongs in that block.** That is what makes the theme one edit instead of thirteen, and what stops the two themes drifting apart.

**It is not an inversion.** Dark surfaces make colours read lighter and less saturated, so the accent and the error red are lifted rather than reused, and `--accent-ink` flips to dark because the accent it sits on is now the lighter of the two. Panels stay lighter than the application background, the same way round as in the light theme, so depth reads the same.

### Native controls do not follow the theme on their own

`color-scheme: light dark` on `:root` is what tells the browser the page supports both, so the parts no stylesheet can reach - scrollbars, the caret, autofill, a control's internal chrome - render in the matching one. Without it those stay in the browser's light palette while everything around them turns dark.

### The map is the part that does not come free

Chrome colours follow the theme because they are `var()` references, re-resolved by the browser. Map colours are **values copied into a layer when it is added**, so a layer created under the light theme keeps its light colours forever.

`src/lib/map/theme.ts` re-applies them. Layers declare what they are through `metadata['studio:role']` - `background`, `grid-line`, `grid-label`, `container-feature` - rather than being recognised by their id, because ids encode where a layer came from and would break this whenever a naming scheme changed elsewhere. **A new themed map layer must be tagged with `role()`, or it will not follow the theme.** `MapCanvas` triggers the repaint by reading `theme.dark` from `styles/theme.svelte.ts`.

The same reason gives layers a second tag. `metadata['studio:mount']` names the mount a layer was added for, so `add-source.ts` can take its own layers off again without matching ids - a mount's name is also the style's source name ([Q32]), so the recipe's layers and Studio's fallback hairlines share both the source and, when one source is drawn, the id.

## Known: `--rule` is a faint border

`--rule` sits at 1.35:1 against `--surface` in both themes - below the 3:1 WCAG asks of a boundary that identifies a control. It is deliberate as a separator and fine there. Where it borders an input, the control is also distinguished by its fill, so it is not a failure - but it is worth revisiting if the borders ever become the only cue. Both themes are equally affected; this predates the dark theme.
