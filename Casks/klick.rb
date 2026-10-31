cask "klick" do
  version "0.5.0"

  on_arm do
    sha256 "8aeaf81d82f3502a7ad2978e29785fb4332c711e0b333b8d4f943b62095834e6"
    url "https://github.com/Surenkh/klick-desktop/releases/download/v#{version}/Klick-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "863d8b2fcfe9c13eb9353563cf70d5ea793b59d637461dc10075c0938e4b0f58"
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
