cask "klick" do
  version "0.6.2"

  on_arm do
    sha256 "9ac46339284af0ac2a8151e7711ce3196dea090cb8c28cef67676a5f0ed7c759"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "5a112fab524270e6e40fa4b035c42c49cec8f323c1cfab43089aac686fb0a323"
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
