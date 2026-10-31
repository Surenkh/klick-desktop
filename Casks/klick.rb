cask "klick" do
  version "0.5.0"

  on_arm do
    sha256 "3f28eacbb1acecfb60687508afffac0c5513f956228b713dc5d99aed73a58053"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "d49b0c8e60d66fc54ae69f5877bd49337e8240219cdc0a5a73bf6a97a75531f2"
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
