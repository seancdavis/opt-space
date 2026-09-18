#!/bin/bash
# Builds OptSpaceHelper.app and registers the native messaging host with Chrome,
# so the extension is allowed to launch host.sh. Run once after loading the
# unpacked extension, and again any time the extension ID changes.
set -euo pipefail

EXTENSION_ID="${1:-}"

if [ -z "$EXTENSION_ID" ]; then
  cat <<'USAGE'
Usage: host/install.sh <extension-id>

To find your extension ID:
  1. Open chrome://extensions
  2. Enable Developer mode
  3. Copy the ID shown under "OptSpace"
USAGE
  exit 1
fi

# Chrome extension IDs are always 32 letters in the range a-p. Catching a wrong
# argument here beats writing a manifest that silently never matches.
if ! [[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  cat >&2 <<ERROR
That doesn't look like an extension ID: $EXTENSION_ID

Expected 32 letters (a-p), shown under "OptSpace" on its card at
chrome://extensions with Developer mode turned on.
ERROR
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.seancdavis.optspace"
OLD_HOST_NAME="com.seancdavis.chrome_shortcuts"
HOST_SCRIPT="$SCRIPT_DIR/host.sh"
HELPER_SOURCE="$SCRIPT_DIR/helper.applescript"
HELPER_APP="$SCRIPT_DIR/OptSpaceHelper.app"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

# The AppleScript is compiled into an app of its own because macOS grants
# Accessibility permission per program. This app is what you allow to drive
# Chrome's interface -- not /usr/bin/osascript, which would extend that right to
# every AppleScript on the machine.
#
# Rebuilding makes it a new program as far as macOS is concerned and drops the
# permission, so the app is left alone unless its source actually changed.
BUILT=false
if [ ! -d "$HELPER_APP" ] || [ "$HELPER_SOURCE" -nt "$HELPER_APP" ]; then
  rm -rf "$HELPER_APP"
  osacompile -o "$HELPER_APP" "$HELPER_SOURCE"
  # osacompile leaves a legacy resource that makes opening the app from Finder
  # ask "Press Run to run this script" instead of running it. Dropping that file
  # makes it behave the same however it's launched. Changing a bundle
  # invalidates its signature, hence the re-sign.
  rm -f "$HELPER_APP/Contents/Resources/applet.rsrc"
  codesign --force --sign - "$HELPER_APP" >/dev/null 2>&1 || true
  BUILT=true
fi

chmod +x "$HOST_SCRIPT"

mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "OptSpace: toggles Chrome's vertical tab sidebar",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

# The host used to be registered under the extension's old name. Drop that
# registration so Chrome isn't left with a second entry for the same script.
rm -f "$MANIFEST_DIR/$OLD_HOST_NAME.json"

cat <<EOF

Installed native messaging host.
  Manifest:  $MANIFEST_PATH
  Script:    $HOST_SCRIPT
  Helper:    $HELPER_APP$([ "$BUILT" = true ] && echo "  (rebuilt)" || echo "  (unchanged)")
  Extension: $EXTENSION_ID

Two more steps:
  1. Allow the helper to drive Chrome's interface: System Settings > Privacy &
     Security > Accessibility, click +, and choose
     $HELPER_APP
  2. Reload the extension at chrome://extensions

Nothing else needs Accessibility permission. If /usr/bin/osascript or /bin/bash
are in that list from an earlier attempt, they can be removed.
EOF
