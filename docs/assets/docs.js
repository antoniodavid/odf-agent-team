/* ODF docs — shared page behaviour: theme, search palette, sidebar, TOC. */
(function () {
  "use strict";

  var base = document.documentElement.dataset.base || "";

  /* ── theme ── */
  (function theme() {
    var root = document.documentElement;
    var saved = localStorage.getItem("odf-theme");
    var system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.dataset.theme = saved || system;
    var toggle = document.getElementById("themeToggle");
    if (!toggle) return;
    toggle.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      localStorage.setItem("odf-theme", next);
    });
  })();

  /* ── sidebar ── */
  (function sidebar() {
    var side = document.querySelector("details.side");
    if (!side) return;
    if (matchMedia("(max-width: 820px)").matches) side.open = false;
    side.addEventListener("toggle", function () {
      if (side.open) side.scrollIntoView({ block: "nearest" });
    });
  })();

  /* ── search palette ── */
  (function search() {
    var overlay = document.getElementById("overlay");
    var input = document.getElementById("q");
    var results = document.getElementById("results");
    if (!overlay || !input || !results) return;

    var G = { home: "Start", doc: "Docs", diagram: "Diagrams", archive: "Archive" };
    var index = [];
    var items = [];
    var active = 0;
    var loaded = null;

    function open() {
      overlay.classList.add("open");
      input.value = "";
      render("");
      input.focus();
      if (!loaded) loaded = fetch(base + "search-index.json").then(function (r) { return r.json(); }).then(function (d) { index = d; });
    }
    function close() { overlay.classList.remove("open"); }

    function score(entry, query) {
      var q = query.toLowerCase();
      var t = entry.title.toLowerCase();
      var k = (entry.keywords || "").toLowerCase();
      var x = (entry.excerpt || "").toLowerCase();
      if (t.indexOf(q) === 0) return 0;
      if (t.indexOf(q) >= 0) return 1;
      if (k.indexOf(q) >= 0) return 2;
      if (x.indexOf(q) >= 0) return 3;
      return -1;
    }

    function esc(value) {
      return String(value).replace(/[&<>"]/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
      });
    }

    function mark(value, query) {
      if (!query) return esc(value);
      var at = value.toLowerCase().indexOf(query.toLowerCase());
      if (at < 0) return esc(value);
      return esc(value.slice(0, at)) + "<mark>" + esc(value.slice(at, at + query.length)) + "</mark>" + esc(value.slice(at + query.length));
    }

    function render(raw) {
      var query = raw.trim();
      var list = index;
      if (query) {
        list = index.map(function (entry) { return { entry: entry, score: score(entry, query) }; })
          .filter(function (row) { return row.score >= 0; })
          .sort(function (a, b) { return a.score - b.score; })
          .map(function (row) { return row.entry; });
      }
      items = list.slice(0, 12);
      active = 0;
      if (!items.length) {
        results.innerHTML = '<div class="empty">No matches for “' + esc(query) + '”.<br>Try ' +
          ["delegate", "gate", "route", "context"].map(function (word) {
            return '<button data-sug="' + word + '">' + word + "</button>";
          }).join(", ") + ".</div>";
        results.querySelectorAll("[data-sug]").forEach(function (button) {
          button.addEventListener("click", function () {
            input.value = button.dataset.sug;
            render(input.value);
            input.focus();
          });
        });
        return;
      }
      var html = "";
      var lastGroup = null;
      items.forEach(function (entry, index) {
        if (entry.kind !== lastGroup) {
          html += '<div class="group">' + (G[entry.kind] || "Docs") + "</div>";
          lastGroup = entry.kind;
        }
        html += '<a class="result' + (index === 0 ? " active" : "") + '" data-i="' + index + '" href="' + esc(base + entry.href) + '">' +
          '<span class="rt">' + mark(entry.title, query) + "</span>" +
          '<span class="rx">' + esc(entry.excerpt || "") + "</span></a>";
      });
      results.innerHTML = html;
      results.querySelectorAll(".result").forEach(function (anchor) {
        anchor.addEventListener("mousemove", function () { setActive(Number(anchor.dataset.i)); });
        anchor.addEventListener("click", function () { close(); });
      });
    }

    function setActive(index) {
      active = index;
      results.querySelectorAll(".result").forEach(function (element, position) {
        element.classList.toggle("active", position === index);
      });
      var current = results.querySelector(".result.active");
      if (current) current.scrollIntoView({ block: "nearest" });
    }

    var trigger = document.getElementById("openSearch");
    if (trigger) trigger.addEventListener("click", open);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });

    document.addEventListener("keydown", function (event) {
      var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) { event.preventDefault(); open(); return; }
      if (event.key === "/" && !typing && !overlay.classList.contains("open")) { event.preventDefault(); open(); return; }
      if (!overlay.classList.contains("open")) return;
      if (event.key === "Escape") { close(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(active + 1, items.length - 1)); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(active - 1, 0)); return; }
      if (event.key === "Enter" && items[active]) {
        event.preventDefault();
        results.querySelectorAll(".result")[active].click();
      }
    });

    input.addEventListener("input", function () { render(input.value); });
    loaded = fetch(base + "search-index.json").then(function (r) { return r.json(); }).then(function (d) { index = d; });
  })();

  /* ── table of contents highlight ── */
  (function contents() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var byId = new Map();
    links.forEach(function (link) {
      byId.set(link.getAttribute("href").slice(1), link);
    });
    var headings = Array.prototype.slice.call(document.querySelectorAll(".prose h2[id], .prose h3[id]"));
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) { link.classList.remove("active"); });
        var current = byId.get(entry.target.id);
        if (current) current.classList.add("active");
      });
    }, { rootMargin: "-15% 0px -70% 0px", threshold: 0 });
    headings.forEach(function (heading) { observer.observe(heading); });
  })();
})();
