import { cleanUrl } from "./lib/clean-url.js";

// Track tab history for the "previous tab" entry at the top of the palette.
// Store as map of windowId -> array of tabIds (most recent at end)
// Uses chrome.storage.session to persist across service worker restarts
let tabHistoryByWindow = {};
let historyLoaded = false;
const MAX_HISTORY_PER_WINDOW = 50;

// Load history from storage (ensures we only load once)
async function ensureHistoryLoaded() {
  if (historyLoaded) return;
  try {
    const result = await chrome.storage.session.get('tabHistoryByWindow');
    if (result.tabHistoryByWindow) {
      tabHistoryByWindow = result.tabHistoryByWindow;
    }
    historyLoaded = true;
  } catch (e) {
    console.error('Failed to load tab history:', e);
    historyLoaded = true; // Prevent repeated failures
  }
}

// Save history to storage
async function saveHistory() {
  await chrome.storage.session.set({ tabHistoryByWindow });
}

// Add a tab to history for its window (called when tab becomes active)
async function addToHistory(tabId, windowId) {
  await ensureHistoryLoaded();
  if (!tabHistoryByWindow[windowId]) {
    tabHistoryByWindow[windowId] = [];
  }
  const history = tabHistoryByWindow[windowId];
  // Remove this tab if it's already in this window's history
  const index = history.indexOf(tabId);
  if (index !== -1) {
    history.splice(index, 1);
  }
  // Add to end (most recent)
  history.push(tabId);
  // Trim if too long
  if (history.length > MAX_HISTORY_PER_WINDOW) {
    tabHistoryByWindow[windowId] = history.slice(-MAX_HISTORY_PER_WINDOW);
  }
  await saveHistory();
}

// Remove a tab from history (called when tab is closed)
async function removeFromHistory(tabId, windowId) {
  await ensureHistoryLoaded();
  if (windowId && tabHistoryByWindow[windowId]) {
    const history = tabHistoryByWindow[windowId];
    const index = history.indexOf(tabId);
    if (index !== -1) {
      history.splice(index, 1);
      await saveHistory();
    }
  } else {
    // If windowId not provided, search all windows
    for (const wid of Object.keys(tabHistoryByWindow)) {
      const history = tabHistoryByWindow[wid];
      const index = history.indexOf(tabId);
      if (index !== -1) {
        history.splice(index, 1);
        await saveHistory();
        break;
      }
    }
  }
}

// Most recently used tabs for a window, most recent first, current tab excluded.
async function recentTabIds(windowId) {
  await ensureHistoryLoaded();
  return [...(tabHistoryByWindow[windowId] || [])].reverse();
}

// Get the previous tab for a specific window
async function getPreviousTabForWindow(windowId) {
  await ensureHistoryLoaded();
  const history = tabHistoryByWindow[windowId];
  if (!history || history.length < 2) return null;
  return history[history.length - 2];
}

// Clean up history for closed windows
async function cleanupClosedWindow(windowId) {
  await ensureHistoryLoaded();
  if (tabHistoryByWindow[windowId]) {
    delete tabHistoryByWindow[windowId];
    await saveHistory();
  }
}

// Listen for tab activation
chrome.tabs.onActivated.addListener((activeInfo) => {
  addToHistory(activeInfo.tabId, activeInfo.windowId);
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  removeFromHistory(tabId, removeInfo.windowId);
});

// Listen for window removal to clean up history
chrome.windows.onRemoved.addListener((windowId) => {
  cleanupClosedWindow(windowId);
});

// Initialize on install: add current active tabs to history
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      const activeTab = win.tabs?.find(t => t.active);
      if (activeTab) {
        await addToHistory(activeTab.id, win.id);
      }
    }
  } catch (e) {
    console.error('Failed to initialize tab history:', e);
  }
});

// Native messaging host that toggles the vertical tab sidebar.
// Chrome exposes no API for the tab strip, so the toggle is delegated to a
// local script that clicks the button via macOS Accessibility.
// See host/install.sh for setup.
const SIDEBAR_HOST = "com.seancdavis.optspace";

async function toggleSidebar() {
  try {
    const response = await chrome.runtime.sendNativeMessage(SIDEBAR_HOST, { action: "toggle-sidebar" });
    // The host answers even when the click didn't happen, so "no error thrown"
    // is not the same as "the sidebar moved".
    if (response?.ok === false) {
      console.error(
        response.error ||
        `Sidebar toggle didn't happen. The helper wrote why to ${response.diagnostic}`
      );
    }
  } catch (e) {
    console.error(
      "Sidebar toggle failed. Run host/install.sh <extension-id> and grant " +
      "Chrome Accessibility permission in System Settings.",
      e
    );
  }
}

// --- The palette -----------------------------------------------------------

// Runs in the page. Everything the palette wants to know that only the page
// can answer.
function readPageContext() {
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
  const selection = String(window.getSelection() || "").trim();
  return {
    canonical,
    selection: selection.slice(0, 4000),
    hasForm: !!document.querySelector("form input, form textarea, form select"),
  };
}

// Runs in the page. The service worker has no clipboard of its own.
function writeClipboard(text) {
  return navigator.clipboard.writeText(text);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function readContext(tabId) {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageContext,
    });
    return injected?.result || {};
  } catch {
    // Restricted pages (chrome://, the Web Store, other extensions) never run
    // our code. The palette still works, it just knows less.
    return {};
  }
}

async function buildItems(tab, page) {
  const clean = cleanUrl(tab.url, page);
  const items = [];

  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
  const tabsById = new Map(windowTabs.map((t) => [t.id, t]));
  const previousTabId = await getPreviousTabForWindow(tab.windowId);

  const tabItem = (t, group, keys) => ({
    id: "switch-tab",
    group,
    title: t.title || t.url,
    sub: hostOf(t.url),
    keys,
    data: { tabId: t.id },
    keywords: `tab ${t.url}`,
  });

  if (previousTabId && tabsById.has(previousTabId)) {
    items.push(tabItem(tabsById.get(previousTabId), "Previous tab", ["↵"]));
  }

  items.push({
    id: "copy-clean",
    group: "This page",
    title: "Copy link",
    sub: clean,
    copy: clean,
    toast: "Link copied",
    keys: ["⌃", "⇧", "C"],
    keywords: "url clean share",
  });

  if (clean !== tab.url) {
    items.push({
      id: "copy-full",
      group: "This page",
      title: "Copy full URL",
      sub: tab.url,
      copy: tab.url,
      toast: "Full URL copied",
      keywords: "url raw original tracking",
    });
  }

  const recent = await recentTabIds(tab.windowId);
  const seen = new Set([tab.id, previousTabId]);
  const ordered = [
    ...recent.map((id) => tabsById.get(id)).filter(Boolean),
    ...windowTabs,
  ];
  for (const other of ordered) {
    if (seen.has(other.id)) continue;
    seen.add(other.id);
    items.push(tabItem(other, "Open tabs"));
  }

  items.push({
    id: "toggle-sidebar",
    group: "Browser",
    title: "Toggle tab sidebar",
    keys: ["⌃", "S"],
    keywords: "vertical tabs strip collapse expand",
  });

  return items;
}

// Injecting is cheap and the overlay guards against installing itself twice,
// so this runs on every open rather than tracking which tabs are ready.
async function ensureOverlay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["palette/overlay.js"],
  });
}

async function openPalette() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const page = await readContext(tab.id);
    const items = await buildItems(tab, page);
    await ensureOverlay(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "palette:open", items });
  } catch (e) {
    console.error("Palette could not open on this page:", e);
  }
}

async function copyLink(tab, { full = false } = {}) {
  const page = await readContext(tab.id);
  const text = full ? tab.url : cleanUrl(tab.url, page);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: writeClipboard,
      args: [text],
    });
    await ensureOverlay(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: "palette:toast",
      message: full ? "Full URL copied" : "Link copied",
    });
  } catch (e) {
    console.error("Copy failed on this page:", e);
  }
}

// What the palette sends back when you pick something it can't do itself.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "palette:run") return;
  (async () => {
    try {
      if (message.id === "switch-tab") {
        await chrome.tabs.update(message.data.tabId, { active: true });
      } else if (message.id === "toggle-sidebar") {
        await toggleSidebar();
      }
    } catch (e) {
      console.error(`Palette action "${message.id}" failed:`, e);
    }
  })();
});

// Handle commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-palette") {
    await openPalette();
    return;
  }

  if (command === "copy-url") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) await copyLink(tab);
    return;
  }

  if (command === "toggle-sidebar") {
    await toggleSidebar();
    return;
  }

  if (command === "switch-to-previous-tab") {
    // Get the current window to find its previous tab
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab) return;

    const previousTabId = await getPreviousTabForWindow(currentTab.windowId);
    if (previousTabId) {
      try {
        // Verify the tab still exists before switching
        await chrome.tabs.get(previousTabId);
        // Switch to the tab (stays in same window)
        await chrome.tabs.update(previousTabId, { active: true });
      } catch (e) {
        // Tab no longer exists, remove it from history
        await removeFromHistory(previousTabId, currentTab.windowId);
      }
    }
  }
});
