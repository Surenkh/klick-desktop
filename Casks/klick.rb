cask "klick" do
  version "0.6.3"

  on_arm do
    sha256 "3b250db2404d3d97393caf34940645670b63418f37acd253c12f085fcad2ee07"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "91ca4a76ef9135c9d7887db831d111efbbb4b4f2419fe6edf758259a5b9af87d"
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
