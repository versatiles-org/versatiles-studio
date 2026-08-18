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
where everyone can see it. This includes the `font` shorthand: write `font-size` and `font-family`
separately, or nine raw sizes hide behind `font: 0.75rem …` where the checks cannot see them.

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

**6. A rule that extends another is nested inside it.** `&:hover`, `&.selected`,
`&[data-state='failed']`, `.child` — never a second top-level rule repeating the parent's selector.

```css
/* not this */                          /* this */
.chip { … }                             .chip {
.chip.on { … }                            …
.chip:hover { … }                         &.on { … }
                                          &:hover { … }
                                        }
```

Nesting is what keeps everything about one element in one place. Flat, the state of `.chip` was
spread over three rules that could drift apart or be edited in isolation; a modifier can no longer be
added to the wrong element without it being visible. **Svelte flattens this at build time** — the
shipped CSS is `.chip.svelte-hash.on`, so there is no browser-support question, and converting the
whole codebase left the compiled output byte-identical across all 408 rules.

`&` means _this same element_, so write it only when the rule extends the parent — `&:hover`,
`&.on`. A descendant is a different element and drops it: `.message`, not `& .message`. That way the
`&` itself tells you which of the two a rule is, instead of the reader having to spot a space.

A combinator keeps its `&`, because it is not a descendant and the bare form reads as a typo:

```css
.entry {
  .detail { … }    /* a descendant of .entry */
  & + li { … }     /* the li after .entry */
}
```

**Not** for multi-selector rules or anything inside `@media` — those are the cases where nesting
changes meaning rather than shape. And **not in `base.css`**: a component's nesting is resolved by
the compiler, but `base.css` ships as written, so nesting there would be a runtime dependency on the
browser rather than a source convention.

These are enforced by `src/lib/styles/tokens.test.ts`, which runs with `npm test`. It fails with the
file and the offending value named. It checks colour, type size, radius, font stacks, fallbacks, the
focus ring, map colours, the button box and nesting — and nothing else, because a rule nobody can
justify is a rule people route around.

## The tokens

Each set is small and closed **on purpose**. That is the whole mechanism: picking from five type
sizes is faster than inventing a sixth, so the constraint holds itself up without anyone policing it.

| Set      | Tokens                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Colour   | `--ink`, `--ink-2`, `--rule`, `--surface`, `--chrome`, `--accent`, `--accent-ink`                                       |
| Semantic | `--error`, `--error-bg`, `--error-rule`                                                                                 |
| Map      | `--map-bg`, `--map-grid`, `--map-grid-halo`, `--map-feature`, `--float-bg`                                              |
| Type     | `--text-xs` 12 · `--text-sm` 13 · `--text-md` 14 (default) · `--text-lg` 17 · `--text-xl` 22, plus `--text-mono-adjust` |
| Fonts    | `--font-ui`, `--font-mono`                                                                                              |
| Space    | `--space-1` … `--space-6`                                                                                               |
| Shape    | `--radius`, `--radius-lg`, `--shadow`, `--shadow-lg`, `--focus-width`                                                   |

**Map colours are separate from the chrome palette**, even where the value is identical today. A grid
drawn over a dark basemap is a different decision from a focus ring, and collapsing them would mean
one of the two gets the wrong answer the first time either changes.

## Type: three rules

**The base size goes on `body`, never on `html`.** A `rem` written on the _root_ element resolves
against the browser's initial 16px, but every other `rem` in the document then resolves against what
the root computed to. `html { font-size: var(--text-md) }` therefore made 1rem mean 14px, and every
token compounded from there — 13px text rendered at 11.4px, 12px labels at 10.5px, and all spacing
came out 12% tighter than written. It is invisible in the source and obvious on screen once you know
to look. `tokens.test.ts` fails if a font size reappears on `html`.

**Declare a size only when it differs from what you would inherit.** `--text-md` is the document
default, so ordinary UI text declares nothing at all. Before this rule, 27 components overrode the
default to a smaller size — which meant the real body size was 12px while the token said 14px, and
every new component had to guess which to copy. There are now 16 size declarations in the whole
application, and none of them is `--text-md`.

| Size                      | For                                           |
| ------------------------- | --------------------------------------------- |
| _(none)_                  | ordinary UI text — inherits `--text-md`, 14px |
| `--text-sm`               | dense data displays: JSON, popups, metadata   |
| `--text-xs`               | labels and counts in the left pane            |
| `--text-lg` / `--text-xl` | panel emphasis; the landing screen            |

**Machine text is monospace; prose is the UI font.** A path, a URL, a layer name, a feature id, a
coordinate, a VPL node, a JSON key — anything a machine produced or a machine will read — gets
`--font-mono`. Anything a person wrote or reads as prose gets the UI font, which is the default and
so is never declared. The two places that had it wrong were a filename and a layer name, both
rendering as prose.

That is why no component declares `--font-ui`: if you find yourself reaching for it, the text is
already in the right face and the declaration is noise.

**`--text-mono-adjust` is not a step on the scale.** Monospace reads optically larger than the UI font
at the same nominal size, so inline `code` is nudged down relative to whatever surrounds it. It is a
font-metric correction, applied once in `base.css`.

## What base.css already gives you

Do not write these again — they are done once, for everything:

| Element                       | You get                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `button`, `input`, `textarea` | `font: inherit`, `color: inherit`, and a themed face          |
| `input`, `select`, `textarea` | background, border, radius, padding                           |
| `button`                      | background, border, radius, cursor, hover and disabled states |
| `ul`, `ol`                    | no markers, no margin, no padding                             |
| `code`, `kbd`, `samp`         | the monospace stack and its optical size correction           |
| anything focusable            | the focus ring                                                |

**Padding is deliberately not in the button rule.** That is layout, and it belongs with the
component; a global value would inflate every small icon button that only wanted the appearance.

## Shared classes

Two, both text treatments that apply to several different elements:

- **`.truncate`** — one line, clipped with an ellipsis. Was written out verbatim in seven places.
- **`.section-label`** — the small uppercase label that titles a section. Six identical declarations
  in two components, four of them repeated in a third. A class rather than an `h2` rule because it
  is not tied to one element: two uses are headings, one is a span inside a button, and Studio's
  other `h2` — the container name in the inspector — is a title rather than a label and must not
  pick it up.

**The bar for a third is high.** A shared class has to be remembered in the markup, which is a second
mechanism to hold in your head alongside scoped CSS. `min-width: 0` was a candidate and did not make
it — it is one declaration, it belongs beside the layout rules that make it necessary, and applying
it through markup at every level of a nesting chain would be easier to get wrong, not harder. Rules
that merely happen to match — two forms that are both `display: flex; gap` — are coincidence, not a
shared element, and abstracting them costs more than it saves.

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

### Native controls do not follow the theme on their own

`color-scheme: light dark` on `:root` is what tells the browser the page supports both, so the parts
no stylesheet can reach — scrollbars, the caret, autofill, a control's internal chrome — render in
the matching one. Without it those stay in the browser's light palette while everything around them
turns dark.

That is necessary but not sufficient. `base.css` also gives every form control and button a **face of
its own**, because leaving it to the browser was how three inputs ended up as white boxes in a dark
pane: they set a border and no background, so they inherited the theme's light text onto the UA's
white. Any control Studio does not draw is a control the operating system draws, and it will not
match.

Ghost buttons opt out explicitly, with `background: none` and a border of their own. **Padding is not
in the global rule** — that is layout, and it belongs with the component; a global value would
inflate every small icon button that only wanted the appearance.

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
