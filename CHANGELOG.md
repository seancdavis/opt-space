# Changelog

## [0.1] - 2026-09-18

First release under the name OptSpace, and the first one built around a palette
rather than a handful of separate shortcuts.

### Added

- A command palette on `Opt+Space`, with the tab you were last on already
  selected, then actions for the page you're on, the window's other tabs in the
  order you used them, and browser commands. Pressing the shortcut again closes
  it, and so does `Esc`.
- Cleaned links: `Ctrl+Shift+C` copies the current page's URL with tracking
  parameters removed, the page's own canonical link preferred when it points at
  the same site, and Amazon product pages collapsed to `/dp/<product id>`.
- Copy full URL, for the times you want the address untouched.

### Changed

- Renamed from Chrome Shortcuts to OptSpace. The local program Chrome talks to
  is now registered as `com.seancdavis.optspace`, so `host/install.sh` has to be
  run once more with the extension's ID.
- The sidebar toggle clicks through `OptSpaceHelper.app`, compiled from
  `host/helper.applescript`. macOS grants permission to control other apps per
  program and doesn't hand Chrome's along to what Chrome launches, so one small
  app holds it instead of every script on the machine.
- `Opt+Space` opens the palette. Jumping to the previous tab still happens from
  there, so the separate shortcut for it ships with no key assigned.

### Fixed

- A sidebar toggle that doesn't happen now says so: the helper writes the reason
  to `/tmp/optspace-diagnostic.txt`, including a map of Chrome's interface when
  the button can't be found, and the failure reaches the service worker console
  instead of being reported as success.
- `host/install.sh` refuses an argument that isn't a Chrome extension ID, rather
  than writing a registration that can never match.
