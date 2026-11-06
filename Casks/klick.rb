cask "klick" do
  version "0.6.1"

  on_arm do
    sha256 "d54c434401929c364194c696e6d79bc093ebf4a5f23114b49cc890de8916091a"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "97b66bee8fae75a14daa8efd7e29e6a91fc755ee6fab7365d89ff16d1a066369"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-x64.dmg"
  end

  name "Klick"
  desc "Keyboard sounds for macOS, with a keycap companion"
  homepage "https://github.com/Surenkh/klick-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Klick.app"

  # Klick is signed locally, not notarized, so Homebrew-installed copies need the
  # quarantine flag cleared before the first launch.
  postflight do
    system_command "/usr/bin/xattr", args: ["-cr", "#{appdir}/Klick.app"]
  end

  zap trash: [
    "~/Library/Application Support/Klick",
  ]
end
