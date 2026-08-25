## Install

**Linux** - a `.deb` for Debian and Ubuntu, or the AppImage anywhere else; both are built for
`amd64` and `arm64`. A `.deb` is compiled against one WebKitGTK version and may not install across
distributions, which is what the AppImage is for.

**macOS** - the `.dmg` for your Mac: `aarch64` for Apple Silicon, `x64` for Intel. **This build is
not notarised**, so macOS will refuse it on first launch. Open **System Settings → Privacy &
Security** and choose **Open Anyway**, or run:

```sh
xattr -d com.apple.quarantine "/Applications/VersaTiles Studio.app"
```

**Windows** - the `x64` `-setup.exe`; on ARM it runs under emulation. **This build is not signed**, so
SmartScreen shows "Windows protected your PC" on first run. Click **More info**, then **Run anyway**.
Code-signing certificates are the deferred part, not the build ([Q10]).

[Q10]: https://github.com/versatiles-org/versatiles-studio/blob/main/docs/decisions.md
