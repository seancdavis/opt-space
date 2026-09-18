// The palette itself: injected into the active tab each time the shortcut
// fires, kept in a shadow root so no page styles leak in or out.
//
// The service worker owns the list of things you can do (it's the only side
// that can see your tabs); this file owns the keyboard and the pixels. Items
// carrying `copy` are handled here, because the clipboard needs a focused
// document and a real keypress. Everything else goes back to the worker.
(() => {
  if (window.__optspace) return;

  const HOST_ID = "optspace-palette";
  let hostEl, shadow, panel, input, listEl, toastEl;
  let items = [];
  let filtered = [];
  let sel = 0;
  let isOpen = false;
  let toastTimer;

  const CSS = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(18, 21, 25, .32);
      display: flex; justify-content: center; align-items: flex-start;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .panel {
      margin-top: 12vh; width: min(620px, calc(100vw - 32px));
      max-height: min(62vh, 560px); display: flex; flex-direction: column;
      background: #fff; color: #14171b;
      border: 1px solid #d0d6dd; border-radius: 14px;
      box-shadow: 0 1px 2px rgba(20,23,27,.06), 0 28px 60px -18px rgba(20,23,27,.34);
      overflow: hidden;
    }
    .search { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid #e2e6eb; }
    .search svg { flex: none; color: #6f7984; }
    input {
      flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
      font: inherit; font-size: 17px; color: #14171b;
    }
    input::placeholder { color: #6f7984; }
    .list { overflow: auto; padding: 4px 8px 8px; flex: 1; min-height: 0; }
    .group {
      font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase;
      color: #6f7984; padding: 10px 8px 4px;
    }
    .row {
      display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; gap: 10px;
      align-items: center; padding: 7px 10px 7px 6px; border-radius: 8px; cursor: pointer;
    }
    .row .lamp { width: 6px; height: 6px; border-radius: 50%; }
    .row[data-sel="true"] { background: #fceedb; }
    .row[data-sel="true"] .lamp { background: #e8890c; box-shadow: 0 0 0 3px rgba(232,137,12,.22); }
    .text { display: flex; flex-direction: column; min-width: 0; }
    .title { font-size: 15px; line-height: 1.35; }
    .sub { font-size: 12.5px; color: #6f7984; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .right { display: flex; gap: 3px; align-items: center; }
    kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
      min-width: 18px; padding: 1px 5px; border: 1px solid #d0d6dd; border-bottom-width: 2px;
      border-radius: 5px; color: #47505a; background: #fff;
    }
    .badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px;
      color: #47505a; border: 1px solid #d0d6dd; border-radius: 5px; padding: 1px 6px;
    }
    .empty { padding: 22px 16px; color: #6f7984; font-size: 14px; }
    .foot {
      display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid #e2e6eb;
      font-size: 12px; color: #6f7984;
    }
    .foot span { display: inline-flex; gap: 4px; align-items: center; }
    .toast {
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      background: #333; color: #fff; padding: 12px 20px; border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,.3);
      opacity: 0; transform: translateY(-10px); transition: opacity .2s, transform .2s;
      pointer-events: none;
    }
    .toast[data-on="true"] { opacity: 1; transform: none; }
    @media (prefers-color-scheme: dark) {
      .panel { background: #1a1e24; color: #e6e9ed; border-color: #2d343c; }
      .search, .foot { border-color: #242a31; }
      input { color: #e6e9ed; }
      .row[data-sel="true"] { background: rgba(242,155,48,.14); }
      .row[data-sel="true"] .lamp { background: #f29b30; }
      kbd { background: #1a1e24; border-color: #2d343c; color: #a8b1bb; }
      .badge { color: #a8b1bb; border-color: #2d343c; }
      .group, .sub, .empty, .foot, .search svg, input::placeholder { color: #808a95; }
    }
    @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
  `;

  function build() {
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    shadow = hostEl.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = CSS;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close();
    });

    panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
        </svg>
        <input type="text" placeholder="Tabs and actions…" spellcheck="false" autocomplete="off">
      </div>
      <div class="list"></div>
      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Run</span><span><kbd>esc</kbd> Close</span>
      </div>`;

    toastEl = document.createElement("div");
    toastEl.className = "toast";

    backdrop.append(panel);
    shadow.append(style, backdrop, toastEl);
    document.documentElement.append(hostEl);

    input = shadow.querySelector("input");
    listEl = shadow.querySelector(".list");

    input.addEventListener("input", () => {
      sel = 0;
      render();
    });
    input.addEventListener("keydown", onKeyDown);
    // Keep the page's own shortcut handlers from seeing what you type in here.
    for (const type of ["keydown", "keyup", "keypress", "input"]) {
      hostEl.addEventListener(type, (event) => event.stopPropagation());
    }

    backdrop.style.display = "none";
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(filtered[sel]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  function move(step) {
    if (!filtered.length) return;
    sel = (sel + step + filtered.length) % filtered.length;
    paint();
  }

  function open(payload) {
    items = payload.items || [];
    if (!hostEl) build();
    isOpen = true;
    sel = 0;
    input.value = "";
    shadow.querySelector(".backdrop").style.display = "flex";
    render();
    input.focus({ preventScroll: true });
  }

  function close() {
    if (!hostEl) return;
    isOpen = false;
    shadow.querySelector(".backdrop").style.display = "none";
  }

  function render() {
    const tokens = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtered = items.filter((item) => {
      const haystack = `${item.title} ${item.sub || ""} ${item.keywords || ""}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });

    listEl.textContent = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nothing matches that.";
      listEl.append(empty);
      return;
    }

    let group = null;
    filtered.forEach((item, index) => {
      if (item.group && item.group !== group) {
        group = item.group;
        const header = document.createElement("div");
        header.className = "group";
        header.textContent = group;
        listEl.append(header);
      }
      listEl.append(rowEl(item, index));
    });
    paint();
  }

  function rowEl(item, index) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.index = String(index);

    const lamp = document.createElement("span");
    lamp.className = "lamp";

    const text = document.createElement("span");
    text.className = "text";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title;
    text.append(title);
    if (item.sub) {
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = item.sub;
      text.append(sub);
    }

    const right = document.createElement("span");
    right.className = "right";
    for (const key of item.keys || []) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      right.append(kbd);
    }
    if (item.badge) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = item.badge;
      right.append(badge);
    }

    row.append(lamp, text, right);
    row.addEventListener("mouseenter", () => {
      sel = index;
      paint();
    });
    row.addEventListener("click", () => run(item));
    return row;
  }

  function paint() {
    const rows = listEl.querySelectorAll(".row");
    rows.forEach((row) => {
      const isSel = Number(row.dataset.index) === sel;
      row.dataset.sel = isSel ? "true" : "false";
      if (isSel) {
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < listEl.scrollTop) listEl.scrollTop = Math.max(0, top - 28);
        else if (bottom > listEl.scrollTop + listEl.clientHeight) {
          listEl.scrollTop = bottom - listEl.clientHeight + 8;
        }
      }
    });
  }

  async function run(item) {
    if (!item) return;
    close();
    if (item.copy) {
      await copy(item.copy);
      toast(item.toast || "Copied");
      return;
    }
    chrome.runtime.sendMessage({ type: "palette:run", id: item.id, data: item.data || null });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can refuse when the page took focus back; the old way
      // still works because we're running inside the page.
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.append(scratch);
      scratch.select();
      document.execCommand("copy");
      scratch.remove();
    }
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.dataset.on = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.dataset.on = "false";
    }, 2000);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "palette:open") {
      // The shortcut is a plain toggle: a second press puts the palette away,
      // whether or not Alt was ever released.
      if (isOpen) close();
      else open(message);
    } else if (message?.type === "palette:toast") {
      if (!hostEl) build();
      toast(message.message);
    }
  });

  window.__optspace = true;
})();
