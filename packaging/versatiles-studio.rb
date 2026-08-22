# The Homebrew cask for VersaTiles Studio (Q10, S5.7).
#
# **This file is a template, not the cask.** Homebrew reads casks from a tap repository — for us
# `versatiles-org/homebrew-versatiles`, as `Casks/versatiles-studio.rb`. This copy lives here so the
# cask is reviewed alongside the packaging it describes, and so bumping it is a diff rather than a
# recollection. `npm run cask` fills in the four values below from a published release.
#
# **Our own tap, not homebrew-cask.** Homebrew's signing audit returns early unless the tap is
# official, so an unsigned cask passes in ours and would not pass there. Submitting upstream waits
# until we notarise.
#
# **Quarantine still applies.** There is no `--no-quarantine` flag and no opt-out variable as of
# 6.0.15, so an install from here meets the same Gatekeeper dialog as a downloaded `.dmg`. The
# `caveats` below is the whole reason this file says anything at all: it is the one moment Homebrew
# will show a user text of ours, and it lands right after the install that is about to be blocked.
cask "versatiles-studio" do
  version "0.0.0"

  on_arm do
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    url "https://github.com/versatiles-org/versatiles-studio/releases/download/v#{version}/VersaTiles-Studio_#{version}_aarch64.dmg",
        verified: "github.com/versatiles-org/versatiles-studio/"
  end
  on_intel do
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    url "https://github.com/versatiles-org/versatiles-studio/releases/download/v#{version}/VersaTiles-Studio_#{version}_x64.dmg",
        verified: "github.com/versatiles-org/versatiles-studio/"
  end

  name "VersaTiles Studio"
  desc "Desktop application for working with map tiles"
  homepage "https://github.com/versatiles-org/versatiles-studio"

  app "VersaTiles Studio.app"

  # Everything the application writes, so `brew uninstall --zap` leaves nothing behind. Recents,
  # bookmarks, layout and installed font families live in the app data directory (Q21); a project is
  # a directory the user chose and is deliberately not listed.
  zap trash: [
    "~/Library/Application Support/org.versatiles.studio",
    "~/Library/Caches/org.versatiles.studio",
    "~/Library/WebKit/org.versatiles.studio",
    "~/Library/Saved Application State/org.versatiles.studio.savedState",
  ]

  caveats <<~EOS
    This build is not notarised, so macOS will refuse to open it the first time.

    Open System Settings > Privacy & Security, find the line naming VersaTiles Studio
    and press "Open Anyway"; or clear the flag yourself:

      xattr -d com.apple.quarantine "/Applications/VersaTiles Studio.app"

    Once per installed version. See the README for why.
  EOS
end
