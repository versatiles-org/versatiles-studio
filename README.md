[![Latest release](https://img.shields.io/github/v/release/versatiles-org/versatiles-studio?label=release&color=blue)](https://github.com/versatiles-org/versatiles-studio/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/versatiles-org/versatiles-studio/ci.yml?branch=main&label=CI)](https://github.com/versatiles-org/versatiles-studio/actions/workflows/ci.yml)
[![Rust coverage](https://img.shields.io/codecov/c/github/versatiles-org/versatiles-studio?flag=rust&label=rust%20coverage)](https://codecov.io/gh/versatiles-org/versatiles-studio?flags[0]=rust)
[![TypeScript coverage](https://img.shields.io/codecov/c/github/versatiles-org/versatiles-studio?flag=typescript&label=typescript%20coverage)](https://codecov.io/gh/versatiles-org/versatiles-studio?flags[0]=typescript)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

# VersaTiles Studio

A cross-platform desktop application for working with map tiles: open them, inspect them, build
processing pipelines, design styles, and produce new tile sets - without a terminal and without a
full GIS.

Built on [Tauri](https://tauri.app) and [versatiles-rs](https://github.com/versatiles-org/versatiles-rs).

## Installing

Downloads are on the [latest release](https://github.com/versatiles-org/versatiles-studio/releases/latest).

### macOS

```sh
brew tap versatiles-org/versatiles
brew install --cask versatiles-studio
```

Or download the `.dmg` - `aarch64` for Apple Silicon, `x64` for Intel.

**macOS will refuse to open it the first time.** This is not a broken download. Release 1 is
deliberately not notarised: an Apple Developer identity costs $99 a year and, more to the point, has
an approval lead time we chose to keep off the critical path ([Q10](docs/decisions.md)). Every build
_is_ ad-hoc signed, which is the minimum a binary needs to run on Apple Silicon at all - what is
missing is Apple's counter-signature saying they have seen it.

Open **System Settings → Privacy & Security**, find the line naming VersaTiles Studio and press
**Open Anyway**; or clear the flag yourself:

```sh
xattr -d com.apple.quarantine "/Applications/VersaTiles Studio.app"
```

Once per installed version. Homebrew applies the same flag, so a cask install meets the same dialog.

### Linux

A `.deb` for Debian and Ubuntu, an AppImage for everything else; both for `amd64` and `arm64`.

```sh
sudo dpkg -i versatiles-studio_*_amd64.deb
# or
chmod +x versatiles-studio_*.AppImage && ./versatiles-studio_*.AppImage
```

Both formats exist because a `.deb` is compiled against one WebKitGTK version and may not install
across distributions ([Q10](docs/decisions.md)).

### Windows

Download the `x64` `-setup.exe`. There is no separate ARM build - Windows on ARM runs this one
under emulation ([S5.9](docs/history.md)).

**Windows will warn you on first run.** SmartScreen shows "Windows protected your PC" for anything
it has not seen signed before; click **More info**, then **Run anyway**. Studio is not code-signed
yet: a certificate is an annual cost with a procurement lead time, and after June 2023 it has to
live on a hardware token or an HSM, which complicates CI ([Q10](docs/decisions.md)). The build
itself is no longer deferred - only the signature.

## Building

```sh
npm install
npm run tauri dev
```

Needs Rust 1.94+, Node 24+, and on Linux `libwebkit2gtk-4.1-dev librsvg2-dev patchelf`. The first
build compiles GDAL from source and takes a while.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the rest: the script conventions, coverage, the sample
containers some tests want, and how a release is cut.

## Privacy

Studio has **no telemetry, no analytics dependency and no account**.

## License

[MIT](LICENSE) - Copyright (c) 2024-2026 Michael Kreil
