# OptSpace

A Chrome extension built around one command palette, opened with the key it's
named after: `Opt+Space`.

## What it does

Press `Opt+Space` on any page and the palette opens with your previously used
tab already selected, so `Opt+Space` then `Enter` jumps back to it. Pressing
`Opt+Space` again puts the palette away, and so does `Esc`.

Below that: actions on the page you're on, your other tabs in the order you last
used them, and browser commands.

Two of them also have their own shortcut, because they get used constantly:

- **Copy link** (`Ctrl+Shift+C`): copies the current page's URL with the tracking
  parameters stripped. Amazon collapses to `/dp/<product id>`, `utm_*` and
  `fbclid` and friends are dropped, and a page's own canonical link wins when
  it's on the same site. The untouched URL is still in the palette as **Copy full
  URL**.
- **Toggle sidebar** (`Ctrl+S`, macOS only): collapses or expands Chrome's
  vertical tab sidebar — [requires extra setup](#toggle-sidebar-setup-macos)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the folder containing this extension

If `Opt+Space` does nothing, two things are worth checking. Anything that holds
`Opt+Space` system-wide (the Claude desktop app, for one) takes the key before
Chrome sees it. And Chrome remembers shortcut assignments across versions of an
extension, so look at `chrome://extensions/shortcuts` to see what the key is
currently bound to.

## Toggle Sidebar setup (macOS)

Chrome gives extensions no API for the vertical tab strip, so this shortcut
reaches the button the only way available: a local script clicks it through
macOS Accessibility. That takes two one-time steps beyond loading the extension.

First, make sure vertical tabs are on. Open `chrome://flags/#vertical-tabs`, set
it to **Enabled**, restart Chrome, then right-click the tab bar and choose
**Move Tabs To The Side**.

Then register the local script, using the extension ID shown on the extension's
card at `chrome://extensions`:

```bash
./host/install.sh <your-extension-id>
```

That build step produces `host/OptSpaceHelper.app`. Grant that app permission to
drive the interface: **System Settings > Privacy & Security > Accessibility**,
click **+**, and choose it from the `host/` folder. Reload the extension and
`Ctrl+S` will toggle the sidebar.

macOS grants this permission per program and doesn't pass it from Chrome to what
Chrome launches, so something has to hold it. A small app of our own keeps it
contained — granting it to `/usr/bin/osascript` or `/bin/bash` instead would let
every script on your machine drive other apps.

### How it works

```
Ctrl+S → extension → native messaging → host/host.sh
       → host/OptSpaceHelper.app → clicks "Collapse tabs"
```

The extension itself sends nothing but a fixed `{"action":"toggle-sidebar"}`
message to a script on your own machine. The shell script and the AppleScript it
was compiled from are short and readable — nothing runs remotely.

The AppleScript tries a known path through Chrome's accessibility tree first,
then falls back to searching for a button labeled "Collapse tabs" / "Expand
tabs". If a Chrome update breaks the fast path, the fallback should still find
it.

### Troubleshooting

Nothing happening on `Ctrl+S`? Open the service worker console via **Inspect
views** on the extension card at `chrome://extensions` — a failed toggle logs
there and points at `/tmp/optspace-diagnostic.txt`, which holds the reason. When
the button can't be found, that file also contains a map of Chrome's interface
to find its new home in.

The usual causes are a missing or stale extension ID in the host manifest
(re-run `host/install.sh` with the right ID), and Accessibility permission not
granted to `host/OptSpaceHelper.app` — or lost, which happens whenever the app
is rebuilt. Remove and re-add it in that list when that happens.

Approach adapted from
[ramysami/tabbar-shortcut-chrome](https://github.com/ramysami/tabbar-shortcut-chrome).

## Customizing Shortcuts

All shortcuts can be customized:

1. Go to `chrome://extensions/shortcuts`
2. Find "OptSpace"
3. Click the pencil icon next to any shortcut
4. Press your preferred key combination

## License

MIT

## Author

[Sean C Davis](https://github.com/seancdavis)
