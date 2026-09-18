# CLAUDE.md

This file provides guidance for Claude Code when working on this project.

## Project Overview

OptSpace is a Chrome Extension (Manifest V3) built around one command palette,
plus direct shortcuts for the handful of actions used daily:

- **Alt+Space** - Open the palette (previous tab preselected)
- **MacCtrl+Shift+C** - Copy a clean link to the current page
- **MacCtrl+S** - Toggle Chrome's vertical tab sidebar (macOS only)

The palette is the front door: tabs, page actions, and (in progress) handoffs
to tools outside the browser. New capability should arrive as a palette entry
first, and earn a direct shortcut only if it turns out to be used constantly.

## File Structure

- `manifest.json` - Extension configuration, permissions, and keyboard shortcuts
- `background.js` - Service worker: commands, tab history, palette item list, actions
- `lib/clean-url.js` - Turns the current URL into the link worth sharing
- `palette/overlay.js` - The palette UI, injected into the active tab on demand
- `host/helper.applescript` - Clicks Chrome's collapse/expand tabs button via macOS Accessibility
- `host/host.sh` - Native messaging host; runs the compiled helper app
- `host/install.sh` - Builds `host/OptSpaceHelper.app` and registers the host with Chrome (takes the extension ID)

## Key Technical Details

- The service worker is an ES module (`"type": "module"` in the manifest), so it
  can import from `lib/`. Injected files cannot — `palette/overlay.js` is
  deliberately self-contained
- Uses Chrome's `commands` API for keyboard shortcuts
- Uses `chrome.scripting.executeScript` to read page context, write the
  clipboard, and inject the palette into the active tab
- Tab history is tracked via `chrome.tabs.onActivated` and `chrome.tabs.onRemoved`,
  stored in `chrome.storage.session` so it survives service worker restarts

### How the palette is split

The service worker owns *what you can do*: it is the only side that can see
your tabs, so it builds the item list and performs anything that touches Chrome
APIs. `palette/overlay.js` owns *the keyboard and the pixels*, and handles
clipboard items itself, because writing the clipboard needs a focused document
and a real keypress.

- Items are plain objects: `{ id, group, title, sub, keys, badge, keywords }`,
  plus either `copy` (text the overlay puts on the clipboard) or `data` (sent
  back to the worker as `{type: "palette:run", id, data}`)
- The overlay guards against double injection with `window.__optspace`, so
  re-injecting on every open is fine and cheaper than tracking ready tabs
- The UI lives in a closed shadow root; the toast uses `z-index: 2147483647`
  (max 32-bit int) to sit above all page content
- The shortcut is a plain toggle: pressing it again while the palette is open
  closes it, whether or not Alt stayed down, which is what Raycast does and what
  the hands expect

### Sidebar toggle

Chrome exposes no extension API for the vertical tab strip, so the toggle goes
out through native messaging to a local script that clicks the button via macOS
Accessibility. Consequences worth remembering:

- The extension side is just `chrome.runtime.sendNativeMessage` — all the real
  work lives in `host/`, which is not part of the loaded extension
- Changing the extension ID (or loading it from a different folder) invalidates
  the host manifest; re-run `host/install.sh <extension-id>`
- The host is registered as `com.seancdavis.optspace`; that name must match in
  `background.js` and `host/install.sh`
- The AppleScript tries a hardcoded accessibility path first, then falls back to
  searching for a button labeled "Collapse tabs" / "Expand tabs". If a Chrome
  update moves things, fix the fast path rather than deepening the search
- macOS grants Accessibility permission per program, and it does not flow from
  Chrome to what Chrome launches. That's why the script is compiled into
  `host/OptSpaceHelper.app` and that app holds the permission — running it
  through `/usr/bin/osascript` would mean granting every AppleScript on the
  machine the right to drive other apps
- Rebuilding the app makes it a new program to macOS and drops the permission,
  so `install.sh` only rebuilds when `helper.applescript` is newer
- Failures are silent in the UI by design (a missed keypress shouldn't pop
  anything up), but never silent on disk: the helper writes the reason to
  `/tmp/optspace-diagnostic.txt`, including a map of Chrome's interface when the
  button can't be found, and `host.sh` answers `{"ok": false}` so the service
  worker logs it

## Testing Changes

After making changes:
1. Go to `chrome://extensions/`
2. Click the refresh icon on the extension card, or click "Load unpacked" again

`lib/clean-url.js` is a pure function and can be exercised directly with Node by
copying it to a `.mjs` file — worth doing when adding site rules.

## Common Tasks

### Adding a palette action
1. Push an item in `buildItems()` in `background.js`
2. If it can be done from the page (clipboard), give it `copy`. Otherwise give it
   an `id` and handle that id in the `palette:run` listener

### Changing the keyboard shortcut default
Edit the `commands` section in `manifest.json`. On Mac, `Ctrl` in a `suggested_key`
means the **Command** key and `MacCtrl` means the actual **Control** key.

A command may specify only the platforms it supports — `toggle-sidebar` omits
`default` so it stays unbound outside macOS instead of colliding with Save Page.
Chrome allows at most four suggested bindings per extension; `switch-to-previous-tab`
ships unbound because the palette covers it.

### Adding a URL cleaning rule
Add to `SITE_RULES` in `lib/clean-url.js`: `params` drops query parameters for
that host, `rewrite` gets the URL object for anything structural.

### Modifying palette or toast appearance
Both are in the `CSS` string at the top of `palette/overlay.js`.

## Limitations

- Chrome extensions cannot override built-in Chrome shortcuts (e.g., Ctrl+Tab)
- The palette cannot open on pages that block content scripts: `chrome://` pages,
  the Chrome Web Store, other extensions, and the new tab page
- Tab switching won't work until you've visited at least 2 tabs after extension load
- Sidebar toggle is macOS-only and needs the native host installed plus
  Accessibility permission granted to `host/OptSpaceHelper.app` (not to Chrome,
  and not to osascript); without both it does nothing visible
