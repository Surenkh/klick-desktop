# Installing Klick on macOS

Download the DMG for your Mac and drag **Klick.app** onto the Applications folder:

## Quick install

```sh
curl -fsSL https://raw.githubusercontent.com/Surenkh/klick-desktop/main/scripts/install.sh | sh
```

Chooses the right architecture, verifies the SHA-256 from the release notes, installs
to `/Applications`, clears the quarantine flag and launches Klick.

## Direct download

| Mac | File |
| --- | --- |
| Apple silicon (M1–M6) | `Klick-0.6.3-arm64.dmg` |
| Intel | `Klick-0.6.3-x64.dmg` |

Not sure which? Apple menu →  About This Mac → the *Chip* line says Apple M… or Intel.

The build is **unsigned** (no Apple Developer ID yet), so macOS will ask you to confirm
the first launch. That is expected and takes one click:

1. Open **Klick** from Applications. macOS says it cannot verify the app → **Done**.
2. **System Settings → Privacy & Security**, scroll to Security, and click
   **Open Anyway** next to Klick. Confirm with Touch ID or your password.
3. Open Klick again → **Open**.

macOS remembers this; later updates may ask once more.

## First run

Klick lives in the menu bar (there is no Dock window once Settings is closed).
Kiki, the keycap companion, appears in the bottom-right corner of the screen.

**Input Monitoring** is the only permission Klick asks for. Settings → *Open
Input Monitoring* → enable Klick. It starts working within a second, no restart.
That permission lets Klick hear *that* a key went down; it never receives
characters, and it never intercepts or delays input — the native helper only
observes HID reports.

Klick does not request Accessibility, Screen Recording, microphone, camera, Full
Disk Access, notifications or network access. There is no account, no telemetry,
and no network code in the app at all.

## Verify the download (optional)

```
shasum -a 256 Klick-0.6.3-arm64.dmg
# 3b250db2404d3d97393caf34940645670b63418f37acd253c12f085fcad2ee07
shasum -a 256 Klick-0.6.3-x64.dmg
# 91ca4a76ef9135c9d7887db831d111efbbb4b4f2419fe6edf758259a5b9af87d
```

## Uninstall

Quit Klick from the menu bar, then move `Klick.app` to the Trash. Settings and
logs live in `~/Library/Application Support/Klick` — delete that folder too if
you want a clean slate. If you connected agents, remove the hooks from inside
Klick first (Settings → Agents → Remove), which deletes only Klick's own entries.
