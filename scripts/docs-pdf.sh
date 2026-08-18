#!/usr/bin/env bash
#
# Builds one PDF of every planning document, in reading order.
#
# A helper for us, not part of the build: nothing in the application depends on it, and it is here
# rather than in package.json because it drives two things that are installed on a machine rather
# than in node_modules — pandoc and Chrome. There is no new dependency to add.
#
#   scripts/docs-pdf.sh [output.pdf]
#
# The order comes from the README's "Planning documents" table rather than from a list kept here.
# That table is already curated — why, who, what, when, what exists, how, decisions, next — and two
# lists would drift the first time a document was added to one of them. A document missing from the
# table is an error rather than a document silently missing from the PDF.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/versatiles-studio-docs.pdf}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

command -v pandoc >/dev/null || {
	echo "pandoc is not installed — brew install pandoc" >&2
	exit 1
}

chrome=""
for candidate in \
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
	"/Applications/Chromium.app/Contents/MacOS/Chromium" \
	"$(command -v google-chrome || true)" \
	"$(command -v chromium || true)"; do
	[ -n "$candidate" ] && [ -x "$candidate" ] && chrome="$candidate" && break
done
[ -n "$chrome" ] || {
	echo "no Chrome or Chromium found — it is what turns the HTML into a PDF" >&2
	exit 1
}

# ---------------------------------------------------------------------------------------------
# Order, from the README
# ---------------------------------------------------------------------------------------------

# A `while read` loop rather than `mapfile`: macOS ships bash 3.2, which does not have it, and a
# helper that only runs for whoever installed a newer bash is not a helper.
ordered=()
while IFS= read -r entry; do
	ordered+=("$entry")
done < <(
	sed -n '/^## Planning documents/,/^## /p' "$root/README.md" |
		grep -oE '\(docs/[a-z0-9-]+\.md\)' | tr -d '()'
)
[ "${#ordered[@]}" -gt 0 ] || {
	echo "found no documents in the README's Planning documents table" >&2
	exit 1
}

missing=""
for file in "$root"/docs/*.md; do
	name="docs/$(basename "$file")"
	printf '%s\n' "${ordered[@]}" | grep -qxF "$name" || missing="$missing $name"
done
[ -z "$missing" ] || {
	echo "not listed in the README's Planning documents table:$missing" >&2
	echo "add it there — that table is what decides this PDF's order" >&2
	exit 1
}

# ---------------------------------------------------------------------------------------------
# One markdown file, with cross-document links turned inward
# ---------------------------------------------------------------------------------------------

# Every heading in the twelve documents is unique, so a link's fragment needs no namespacing: the
# whole of `other.md#q32--…` becomes `#q32--…` and lands where it should. The check below is what
# keeps that true rather than assumed.
#
# A link to a document with no fragment has nothing to aim at, so each one gets an explicit anchor
# named after its file — `#doc-vision` — which avoids having to reproduce GitHub's slug rules for a
# title in a shell script.
combined="$work/all.md"
: >"$combined"

append() {
	local path="$1" stem
	stem="$(basename "$path" .md)"
	printf '\n\n<div class="document" id="doc-%s"></div>\n\n' "$stem" >>"$combined"
	# Order matters: a link with a fragment loses only its file part, so it must be matched before
	# the one without, which is otherwise a prefix of it.
	sed -E \
		-e 's|\]\((\.\./)?(docs/)?[a-z0-9-]+\.md#|](#|g' \
		-e 's|\]\((\.\./)?(docs/)?([a-z0-9-]+)\.md\)|](#doc-\3)|g' \
		-e 's|\[([^]]*)\]\(docs/\)|\1|g' \
		"$path" >>"$combined"
}

append "$root/README.md"
for name in "${ordered[@]}"; do append "$root/$name"; done

# ---------------------------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------------------------

html="$work/all.html"
pandoc \
	--from gfm+gfm_auto_identifiers \
	--to html5 \
	--standalone \
	--toc --toc-depth=2 \
	--metadata title="VersaTiles Studio — Planning Documents" \
	--include-in-header "$root/scripts/docs-pdf.head.html" \
	--output "$html" \
	"$combined"

# Mermaid renders in the browser that is about to print this. Loaded from the CDN because the one
# diagram in these documents is not worth vendoring a renderer for; with no network the block stays
# visible as its own source, which is a worse diagram rather than a missing page.
cat >>"$html" <<'MERMAID'
<script type="module">
	import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
	document.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
		const holder = document.createElement('pre');
		holder.className = 'mermaid';
		holder.textContent = code.textContent;
		code.parentElement.replaceWith(holder);
	});
	await mermaid.run({ querySelector: 'pre.mermaid' });
</script>
MERMAID

# Every fragment a link points at has to exist, or the PDF quietly loses its cross-references — the
# failure a reader only finds by clicking. Checked here rather than trusted.
python3 - "$html" <<'CHECK'
import re, sys
html = open(sys.argv[1], encoding='utf8').read()
ids = set(re.findall(r'id="([^"]+)"', html))
missing = sorted({f for f in re.findall(r'href="#([^"]+)"', html) if f not in ids})
if missing:
    print('links point at anchors that do not exist:', file=sys.stderr)
    for fragment in missing[:20]:
        print(f'  #{fragment}', file=sys.stderr)
    sys.exit(1)
print(f'  {len(ids)} anchors, every link resolves')
CHECK

# ---------------------------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------------------------

# `--no-pdf-header-footer` drops Chrome's own running header, which is where its page numbers and
# the `file://` URL of a temporary directory would otherwise appear.
#
# `--virtual-time-budget` lets the mermaid import and render finish; printing is otherwise racing a
# module fetch it never waits for.
"$chrome" \
	--headless=new \
	--disable-gpu \
	--no-pdf-header-footer \
	--virtual-time-budget=20000 \
	--print-to-pdf="$out" \
	"file://$html" 2>/dev/null

echo "  $(basename "$out") — $(du -h "$out" | cut -f1)"
