#!/usr/bin/env bash
#
# Removes build-script output directories that no longer belong to any build.
#
#   scripts/prune-build-dirs.sh [--delete] [profile...]
#
# A helper for us, not part of the build. Cargo gives every build script a directory named after a
# fingerprint of its inputs, and starts a fresh one whenever those inputs change - a dependency
# bump, a feature, an environment variable in `.cargo/config.toml`. It never removes the old one.
# Most are kilobytes and nobody notices. `gdal-src` is 1.4 GB each, and seven of them once filled
# the disk mid-build.
#
# `cargo clean` is the blunt version: it also removes the directory in use, so the next build spends
# a quarter of an hour compiling GDAL again. This removes only what nothing points at.
#
# **Cargo is the authority on what is in use, and nothing else is.** Directory mtimes look like they
# would answer this and do not: a build that reuses an output does not touch it, so the live
# directory can be the oldest one there. `--message-format=json` reports `build-script-executed`
# with the real `out_dir` for every script in the build, including the ones it found fresh, so the
# query below costs nothing when there is nothing to build.
#
# **A profile that is not enumerated is not pruned.** The live set is only ever known for the
# configuration just asked about, and `target/release` holds a build this script knows nothing about
# when it is asked about `dev`. Pruning it from a debug query would delete outputs a release build
# needs. So each profile prunes itself or is left alone, which is why profiles are named rather than
# discovered.
#
# Worth knowing before running it: removing a live directory would cost a rebuild, never a wrong
# build. Cargo re-runs a build script whose output is missing. The care taken here is about time.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

delete=false
profiles=()
for argument in "$@"; do
	case "$argument" in
		--delete) delete=true ;;
		-*) echo "unknown option: $argument" >&2; exit 1 ;;
		*) profiles+=("$argument") ;;
	esac
done
# `dev` writes to `target/debug`; the mapping is cargo's, not ours, hence the case below.
[ "${#profiles[@]}" -gt 0 ] || profiles=(dev)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

total=0
for profile in "${profiles[@]}"; do
	case "$profile" in
		dev) directory=debug; flags=() ;;
		release) directory=release; flags=(--release) ;;
		*) directory="$profile"; flags=(--profile "$profile") ;;
	esac

	build="target/$directory/build"
	[ -d "$build" ] || { echo "$profile: no $build - nothing to prune"; continue; }

	# A no-op when the profile is already built, and a full build when it is not. That is the price
	# of asking, and it is why profiles are named explicitly rather than swept.
	live="$work/$directory.live"
	cargo build --workspace "${flags[@]}" --message-format=json 2>/dev/null |
		python3 -c '
import sys, json
for line in sys.stdin:
    try:
        message = json.loads(line)
    except ValueError:
        continue
    if message.get("reason") == "build-script-executed":
        print(message["out_dir"])
' | sort -u >"$live"

	# An empty live set means the query failed rather than that everything is stale - refusing here
	# is the difference between pruning and `cargo clean`.
	[ -s "$live" ] || {
		echo "$profile: cargo reported no build scripts at all; refusing to prune" >&2
		exit 1
	}

	# `grep -qxF` rather than an associative array: macOS ships bash 3.2, which has none.
	for candidate in "$build"/*/out; do
		[ -d "$candidate" ] || continue
		grep -qxF "$root/$candidate" "$live" && continue

		size="$(du -sk "$(dirname "$candidate")" | cut -f1)"
		total=$((total + size))
		if $delete; then
			rm -rf "$(dirname "$candidate")"
			printf 'removed  %6s MB  %s\n' "$((size / 1024))" "$(basename "$(dirname "$candidate")")"
		else
			printf 'stale    %6s MB  %s\n' "$((size / 1024))" "$(basename "$(dirname "$candidate")")"
		fi
	done
done

verb=$($delete && echo freed || echo reclaimable)
printf '%s: %s MB\n' "$verb" "$((total / 1024))"
$delete || echo 'nothing was removed - re-run with --delete'
