#!/bin/bash
# The native messaging host: the local program Chrome launches on the
# extension's behalf, registered by host/install.sh.
#
# Chrome speaks a length-prefixed protocol over stdio in both directions:
# a 4-byte little-endian length followed by a JSON payload. There's only one
# action so far, so the request is read and discarded.
#
# The click itself happens inside OptSpaceHelper.app rather than here, because
# macOS grants Accessibility permission per program: a small app of our own can
# hold that permission without handing it to every script on the machine.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/OptSpaceHelper.app/Contents/MacOS/applet"
DIAGNOSTIC="/tmp/optspace-diagnostic.txt"

# Read the 4-byte header, then exactly that many bytes of body. dd is used
# rather than head because it stops at the byte we asked for instead of
# buffering past it.
LENGTH=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' ')
if [ -n "$LENGTH" ] && [ "$LENGTH" -gt 0 ] 2>/dev/null; then
  dd bs=1 count="$LENGTH" of=/dev/null 2>/dev/null
fi

rm -f "$DIAGNOSTIC"

if [ ! -x "$HELPER" ]; then
  RESPONSE='{"ok":false,"error":"OptSpaceHelper.app is missing. Run host/install.sh <extension-id>."}'
else
  "$HELPER" >/dev/null 2>&1
  # The helper writes that file only when it couldn't click, so its presence is
  # the difference between "done" and the silent failure this used to report as
  # success.
  if [ -f "$DIAGNOSTIC" ]; then
    RESPONSE="{\"ok\":false,\"diagnostic\":\"$DIAGNOSTIC\"}"
  else
    RESPONSE='{"ok":true}'
  fi
fi

# Respond so Chrome's sendNativeMessage callback resolves instead of erroring.
# The response is always well under 256 bytes, so only the low byte varies.
printf "\\$(printf '%03o' ${#RESPONSE})"
head -c 3 /dev/zero
printf '%s' "$RESPONSE"
