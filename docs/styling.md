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
| Rhythm   | `--gap-group`, `--gap-section` - what a gap _separates_ rather than how wide it is, for a pane's own layout                                     |
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

Do not write these again - they are done once, for everything:

| Element                                 | You get                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `button`, `input`, `select`, `textarea` | `font: inherit`, `color: inherit`                                     |
| text fields, `select`, `textarea`       | background, border, radius, padding - a themed face                   |
| checkbox, radio, range                  | `accent-color` - Studio's accent rather than the platform's blue      |
| `input[type=color]`                     | a colour well the size of the row it sits in, framed in `--rule`      |
| `input[type=number]`                    | right-aligned, tabular figures                                        |
| `button`                                | cursor, the disabled colour, and **no box at all**                    |
| `.button`                               | the box, on request: background, border, radius and a compact padding |
| anything that fades when disabled       | `--disabled-opacity`, the one value                                   |
| `ul`, `ol`                              | no markers, no margin, no padding                                     |
| `code`, `kbd`, `samp`                   | the monospace stack and its optical size correction                   |
| anything focusable                      | the focus ring                                                        |

## Shared classes

Four, each applying to elements that have nothing else in common - which is why they are classes rather than element rules:

| Class              | What it is                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.button`          | A button drawn _as_ a button. `button` itself carries no box, so this is how one is asked for; `.button.primary` is the one that commits.                                             |
| `.section-label`   | The small uppercase label that titles a section. Not an `h2` rule: two uses are headings, one is a span inside a button, and the inspector's own `h2` is a title rather than a label. |
| `.truncate`        | One line, clipped with an ellipsis. Written out in full in seven places before it existed.                                                                                            |
| `.visually-hidden` | Present for a screen reader and absent for everyone else. Stock, which is why three components had identical copies.                                                                  |

**Only one of them is a utility**, and the distinction is worth keeping: `.truncate` is a rule applied through the markup, which is a second mechanism to hold in your head alongside scoped CSS. `.button` and `.section-label` name a _thing_ rather than a declaration, and `.visually-hidden` is the standard recipe rather than a decision of ours. The bar for a second utility is therefore high - `min-width: 0` was a candidate and did not make it.

This is not a utility framework and should not become one. If a rule is true of one surface, it lives in that surface's `<style>` block.

## The kit

The layer between the tokens and the components ([S12](history.md), [Q70](decisions.md); every
surface since [S13](history.md), [Q71](decisions.md)). The tokens stopped raw values; they did not
stop the same _part_ being spelled five ways - a note under a control was `note`, `hint`, `empty`,
`nothing` and `none` in five panes, each with its own scoped rule. The kit is the parts a surface is
made of, each written once, and a test (`kit.test.ts`) that fails when a component spells one of them
by hand.

**Two levels of heading, and no third.** A pane's title is the uppercase `.section-label` in its
header, and that is the only uppercase label in the sidebars; the launcher's two column titles are
the other place it is allowed. Inside a pane or a dialog, a group of controls has a `Group` heading:
sentence case, `--text-sm`, weight 600, with an optional action beside it. Nothing below that carries
a heading - a field has a label, a note has a tone.

**One density.** Labels and counts are `--text-xs`; body text in a pane is `--text-sm`. A label column
is `--label-width` wide wherever a label sits beside a control, so the controls of every pane line up.
Parts of one group sit `--gap-group` apart, groups `--gap-section` apart - the two rhythm tokens, and
no other vertical spacing inside a pane body.

**Two highlights, two meanings.** `--chrome` marks the row under the cursor or the arrow keys - in a
menu, a picker, a result list. The accent tint with the inset bar marks the item that is _current_ -
the source being edited, the background in use, the view the map is on. Nothing uses one for the
other.

**Two error presentations, by scope.** A `Note tone="problem"` for a field, a group or a dialog. The
`--error-bg` band only for state of a whole surface: the status bar, a boundary that has stopped
working, the launcher.

| Part         | Is                                                                                                                                                                                                                                                                                                                               | Not for                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `.pane-body` | The column a pane's groups stack in: full height, scrolls, `--gap-section` between groups                                                                                                                                                                                                                                        | Anything outside a pane                        |
| `Group`      | A heading in sentence case, an optional action (reset, clear), and what it groups                                                                                                                                                                                                                                                | A pane title - that is the header's            |
| `Field`      | A label beside a control, the label `--label-width` wide; an optional trailing part for an amount or a clear                                                                                                                                                                                                                     | A list row                                     |
| `Note`       | A line of secondary text with a tone: `hint` under a control, `empty` where there is nothing yet, `aside` for something the map is doing that the person did not ask for, `problem` for an error, `lead` for a dialog's one sentence about itself; `live` for a line whose text arrives on its own, holding its line while empty | Headings, labels, button text                  |
| `Tabs`       | A row of tabs over one panel: one look, arrow keys, an optional badge and a trailing slot                                                                                                                                                                                                                                        | Two states of one list - that is a filter      |
| `Icon`       | Every glyph Studio draws, as one SVG set: the map's controls, the panes' ×, ✎, ↑, ↓, ↺, ↻, the eyes, the power switch, the chevron                                                                                                                                                                                               | A glyph typed as text                          |
| `BarPanel`   | A panel the status bar expands into: capped, scrolling, with `tools` above and a `footer` below; `BarRow` is one of its rows, led by a state dot, with a preformatted block that opens under it                                                                                                                                  | A list in a pane                               |
| `.toolbar`   | A row of buttons that act on the group above it                                                                                                                                                                                                                                                                                  | A row of controls that is a list entry         |
| `.list-row`  | A row in a list or tree: controls and a name, one line, `--text-xs`                                                                                                                                                                                                                                                              | A form row - that is a `Field`                 |
| `.facts`     | A definition list of label and value, one per row                                                                                                                                                                                                                                                                                | A form - that is a column of `Field`s          |
| `.figures`   | Numbers in columns, right-aligned; the first column names the row                                                                                                                                                                                                                                                                | A list to act on: `.list-row`                  |
| `.button`    | A button drawn as a button; `.primary` commits, `.on` is a toggle that is lit, `.quiet` is accent text with no box for reset, clear, undo, and `.quiet.danger` the one word that cannot be undone                                                                                                                                | Icon glyphs                                    |
| `.icon`      | A glyph button around an `Icon` - secondary ink, `--text-xs`, no box; `.danger` reddens on hover, `.on` is a toggle that is lit                                                                                                                                                                                                  | Anything with a word in it                     |
| `.add`       | The "+ …" that adds something: an operation, a parameter, a source, a step, a view - secondary ink at label size                                                                                                                                                                                                                 | A button that commits                          |
| `.link`      | A word that goes somewhere, underlined to say so - github, retry, the log file                                                                                                                                                                                                                                                   | An `<a href>`, which would navigate the window |
| `.popover`   | The face of anything that floats: a menu, a picker, the help, a dropdown panel, a result list, the feature popup - `--float-bg`, `--radius-lg`, the shadow, the blur. Where it sits is the owner's                                                                                                                               | The tooltip, a caption rather than a surface   |
| `.chevron`   | The rotating `Icon` of a disclosure; `.open` turns it                                                                                                                                                                                                                                                                            | A fold that is not a disclosure                |
| `.truncate`  | One line, clipped (already a shared class)                                                                                                                                                                                                                                                                                       |                                                |

A component may still have a scoped `<style>` for what is true of it alone - a tree's indent, the
pipe between nodes, a swatch, where a popover sits. What it may not do is restyle a part: a `Note`
that is a different grey in one pane is the drift this stops. A class that names a part belongs to
the part: the map's square buttons are `.map-button`, not `.icon`, because the two are different
things and shared a name for a release.

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
