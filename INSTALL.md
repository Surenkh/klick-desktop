# Installing Klick on macOS

Download the DMG for your Mac and drag **Klick.app** onto the Applications folder:

| Mac | File |
| --- | --- |
| Apple silicon (M1/M2/M3/M4) | `Klick-0.4.3-arm64.dmg` |
| Intel | `Klick-0.4.3-x64.dmg` |

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
shasum -a 256 Klick-0.4.3-arm64.dmg
# 65ec893cfb180846aa28464bdb818dcf700e7ef06363ec325358b87c47c7dfa4
shasum -a 256 Klick-0.4.3-x64.dmg
# b0b0f3e8b4d235c5de35f37693b223cad92d7b848a82f0d9a3083d7dcf8c3cd7
```

## Uninstall

Quit Klick from the menu bar, then move `Klick.app` to the Trash. Settings and
logs live in `~/Library/Application Support/Klick` — delete that folder too if
you want a clean slate. If you connected agents, remove the hooks from inside
Klick first (Settings → Agents → Remove), which deletes only Klick's own entries.
