#!/bin/sh
# Confirm only one Klick bundle is registered with LaunchServices.
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
echo "== Klick bundles known to LaunchServices:"
"$LSREG" -dump 2>/dev/null | grep -i "klick.app" | sed 's/^[[:space:]]*//' | sort -u | head -20
echo
echo "== on disk:"
ls -d /Applications/Klick.app 2>/dev/null || echo "  /Applications/Klick.app missing"
ls -d dist/mac*/Klick.app 2>/dev/null || echo "  no staging bundles in dist/"
