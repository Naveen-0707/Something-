/* Second Brain — local-first notes with wiki-links, backlinks, search & graph.
   No dependencies, no backend. All data lives in localStorage. */
(() => {
  "use strict";

  const STORAGE_KEY = "second-brain.notes.v1";
  const ACTIVE_KEY = "second-brain.active.v1";

  // ---------- State ----------
  /** @type {{id:string,title:string,body:string,created:number,updated:number}[]} */
  let notes = [];
  let activeId = null;
  let saveTimer = null;

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const noteList = $("#noteList");
  const titleInput = $("#titleInput");
  const bodyInput = $("#bodyInput");
  const preview = $("#preview");
  const backlinksEl = $("#backlinks");
  const searchInput = $("#search");
  const savedHint = $("#savedHint");
  const emptyState = $("#emptyState");

  // ---------- Utils ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = (s) => (s || "").trim().toLowerCase();
  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    if (d < 604800) return Math.floor(d / 86400) + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- Persistence ----------
  function load() {
    try {
      notes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      notes = [];
    }
    activeId = localStorage.getItem(ACTIVE_KEY);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }

  // ---------- Note ops ----------
  const getNote = (id) => notes.find((n) => n.id === id);
  const findByTitle = (title) => notes.find((n) => norm(n.title) === norm(title));

  function createNote(title = "", body = "") {
    const now = Date.now();
    const note = { id: uid(), title, body, created: now, updated: now };
    notes.unshift(note);
    activeId = note.id;
    persist();
    return note;
  }

  function deleteNote(id) {
    notes = notes.filter((n) => n.id !== id);
    if (activeId === id) activeId = notes[0]?.id || null;
    persist();
  }

  // ---------- Wiki-link parsing ----------
  // Returns array of link target titles referenced in a body.
  function extractLinks(body) {
    const out = [];
    const re = /\[\[([^\[\]]+?)\]\]/g;
    let m;
    while ((m = re.exec(body))) {
      const t = m[1].split("|")[0].trim();
      if (t) out.push(t);
    }
    return out;
  }

  // Notes that link TO the given note (by title).
  function backlinksFor(note) {
    if (!note) return [];
    const target = norm(note.title);
    return notes
      .filter((n) => n.id !== note.id && extractLinks(n.body).some((l) => norm(l) === target))
      .map((n) => ({ note: n, context: linkContext(n.body, note.title) }));
  }

  function linkContext(body, title) {
    const idx = body.toLowerCase().indexOf("[[" + title.toLowerCase());
    if (idx === -1) return "";
    const start = Math.max(0, idx - 40);
    const end = Math.min(body.length, idx + title.length + 44);
    let snippet = body.slice(start, end).replace(/\n/g, " ");
    snippet = escapeHtml(snippet).replace(
      /\[\[([^\]]+)\]\]/g,
      (_, t) => `<mark>${escapeHtml(t)}</mark>`
    );
    return (start > 0 ? "…" : "") + snippet + (end < body.length ? "…" : "");
  }

  // ---------- Markdown renderer (small, safe, supports [[wiki-links]]) ----------
  function renderMarkdown(src) {
    // Pull out fenced code blocks first so they aren't mangled.
    const codeBlocks = [];
    src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(code.replace(/^\n/, ""));
      return `\uE000CB${codeBlocks.length - 1}\uE000`;
    });

    const lines = src.split("\n");
    let html = "";
    let listType = null; // 'ul' | 'ol'
    let inQuote = false;

    const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
    const closeQuote = () => { if (inQuote) { html += "</blockquote>"; inQuote = false; } };

    for (let raw of lines) {
      const line = raw;
      if (/^\s*$/.test(line)) { closeList(); closeQuote(); continue; }

      let h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); closeQuote(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); closeQuote(); html += "<hr/>"; continue; }

      // Table row: | a | b |  (separator rows like |---|---| are dropped later)
      if (/^\s*\|.*\|\s*$/.test(line)) {
        closeList(); closeQuote();
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
        continue;
      }

      let bq = line.match(/^>\s?(.*)$/);
      if (bq) { closeList(); if (!inQuote) { html += "<blockquote>"; inQuote = true; } html += inline(bq[1]) + "<br/>"; continue; }
      closeQuote();

      let ul = line.match(/^\s*[-*+]\s+(.*)$/);
      let ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ul) { if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += `<li>${inline(ul[1])}</li>`; continue; }
      if (ol) { if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += `<li>${inline(ol[1])}</li>`; continue; }

      closeList();
      html += `<p>${inline(line)}</p>`;
    }
    closeList(); closeQuote();

    // Wrap runs of table rows in <table>, then drop markdown separator rows.
    html = html
      .replace(/(?:<tr>.*?<\/tr>)+/gs, (m) => `<table>${m}</table>`)
      .replace(/<tr>(?:<td>[-:\s]*<\/td>)+<\/tr>/g, "");

    // Restore code blocks.
    html = html.replace(/\uE000CB(\d+)\uE000/g, (_, i) =>
      `<pre><code>${escapeHtml(codeBlocks[+i])}</code></pre>`);
    return html;
  }

  function inline(text) {
    // Protect inline code spans.
    const spans = [];
    text = text.replace(/`([^`]+)`/g, (_, c) => { spans.push(c); return `\uE001${spans.length - 1}\uE001`; });

    text = escapeHtml(text);

    // [[wiki-link]] or [[target|alias]]
    text = text.replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner) => {
      const [targetRaw, aliasRaw] = inner.split("|");
      const target = targetRaw.trim();
      const label = (aliasRaw || targetRaw).trim();
      const exists = !!findByTitle(target);
      return `<a class="wikilink${exists ? "" : " missing"}" data-link="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
    });

    // [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`);
    // bold, italic, strikethrough
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    text = text.replace(/\uE001(\d+)\uE001/g, (_, i) => `<code>${escapeHtml(spans[+i])}</code>`);
    return text;
  }

  // ---------- Tags ----------
  let activeTag = null;

  // Extract #tags from a body (letters/digits/_/-, not inside the middle of words).
  function extractTags(body) {
    const out = new Set();
    const re = /(^|\s)#([\p{L}0-9_\-]+)/gu;
    let m;
    while ((m = re.exec(body))) out.add(m[2]);
    return [...out];
  }

  function noteHasTag(n, tag) {
    return extractTags(n.body).some((t) => norm(t) === norm(tag));
  }

  function renderTagBar() {
    const tagBar = $("#tagBar");
    if (!tagBar) return; // tolerate older cached HTML
    const counts = new Map();
    for (const n of notes) for (const t of extractTags(n.body)) counts.set(t, (counts.get(t) || 0) + 1);
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (tags.length === 0) { tagBar.innerHTML = ""; return; }
    tagBar.innerHTML = tags.map(([t, c]) =>
      `<span class="tag-chip${norm(activeTag) === norm(t) ? " active" : ""}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}<span class="tc-count">${c}</span></span>`
    ).join("");
  }

  // ---------- Rendering: sidebar ----------
  function renderList(query = "") {
    const q = norm(query);
    noteList.innerHTML = "";
    let items = notes.slice();

    if (activeTag) items = items.filter((n) => noteHasTag(n, activeTag));

    if (q) {
      items = items
        .map((n) => ({ n, score: matchScore(n, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.n);
    } else {
      items.sort((a, b) => b.updated - a.updated);
    }
    // Pinned notes always float to the top, preserving order otherwise.
    items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    renderTagBar();

    if (items.length === 0) {
      noteList.innerHTML = `<div style="padding:14px;color:var(--text-faint);font-size:13px">No matches.</div>`;
      return;
    }

    for (const n of items) {
      const div = document.createElement("div");
      div.className = "note-item" + (n.id === activeId ? " active" : "");
      div.dataset.id = n.id;
      const title = n.title || "Untitled";
      const pin = n.pinned ? `<span class="ni-pin" title="Pinned">📌</span>` : "";
      const tagCount = extractTags(n.body).length;
      const meta = `${extractLinks(n.body).length} links${tagCount ? ` · ${tagCount} tags` : ""} · ${timeAgo(n.updated)}`;
      div.innerHTML = `<div class="ni-title">${pin}${highlight(title, q)}</div><div class="ni-meta">${meta}</div>`;
      noteList.appendChild(div);
    }
  }

  function matchScore(n, q) {
    const title = norm(n.title);
    const body = norm(n.body);
    if (title.includes(q)) return 100 - title.indexOf(q);
    if (body.includes(q)) return 40;
    return 0;
  }

  function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q);
    if (i === -1) return safe;
    return safe.slice(0, i) + "<mark>" + safe.slice(i, i + q.length) + "</mark>" + safe.slice(i + q.length);
  }

  // ---------- Rendering: editor + backlinks ----------
  function openNote(id) {
    const n = getNote(id);
    if (!n) return;
    activeId = id;
    titleInput.value = n.title;
    bodyInput.value = n.body;
    persist();
    if (!preview.hidden) updatePreview();
    renderList(searchInput.value);
    renderBacklinks();
    updatePinBtn();
  }

  function updatePinBtn() {
    const btn = $("#pinBtn");
    const n = getNote(activeId);
    if (!btn || !n) return; // tolerate older cached HTML
    btn.style.opacity = n.pinned ? "1" : "0.5";
    btn.title = n.pinned ? "Unpin note" : "Pin note to top";
  }

  function renderBacklinks() {
    const n = getNote(activeId);
    const links = backlinksFor(n);
    if (!n || links.length === 0) { backlinksEl.innerHTML = ""; return; }
    backlinksEl.innerHTML = `<h4>↩ ${links.length} backlink${links.length > 1 ? "s" : ""}</h4>` +
      links.map((l) =>
        `<div class="backlink-item" data-id="${l.note.id}">
           <div class="bl-title">${escapeHtml(l.note.title || "Untitled")}</div>
           <div class="bl-ctx">${l.context}</div>
         </div>`).join("");
  }

  function updatePreview() {
    preview.innerHTML = renderMarkdown(bodyInput.value);
  }

  function flushSave() {
    const n = getNote(activeId);
    if (!n) return;
    n.title = titleInput.value;
    n.body = bodyInput.value;
    n.updated = Date.now();
    persist();
    savedHint.textContent = "Saved ✓";
    renderList(searchInput.value);
    renderBacklinks();
    if (!preview.hidden) updatePreview();
    setTimeout(() => (savedHint.textContent = ""), 1200);
  }

  function scheduleSave() {
    savedHint.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 450);
  }

  function refreshAll() {
    const has = notes.length > 0;
    emptyState.hidden = has;
    if (has && !getNote(activeId)) activeId = notes[0].id;
    if (has) openNote(activeId);
    renderList(searchInput.value);
  }

  // ---------- Navigate to a wiki-link (create if missing) ----------
  function navigateToTitle(title) {
    flushSaveImmediate();
    let n = findByTitle(title);
    if (!n) { n = createNote(title, ""); toast(`Created “${title}”`); }
    activeId = n.id;
    refreshAll();
    if (!preview.hidden) updatePreview();
    titleInput.focus();
  }

  function flushSaveImmediate() {
    clearTimeout(saveTimer);
    flushSave();
  }

  // ============================================================
  //  GRAPH VIEW — force-directed layout on canvas
  // ============================================================
  const graphView = $("#graphView");
  const canvas = $("#graphCanvas");
  const ctx = canvas.getContext("2d");
  let graph = { nodes: [], edges: [] };
  let rafId = null;
  let view = { x: 0, y: 0, scale: 1 };
  let dragNode = null, panning = false, lastMouse = { x: 0, y: 0 };

  function buildGraph() {
    const byTitle = new Map(notes.map((n) => [norm(n.title), n.id]));
    const nodes = notes.map((n, i) => ({
      id: n.id,
      title: n.title || "Untitled",
      x: Math.cos((i / notes.length) * 2 * Math.PI) * 180 + (Math.random() - .5) * 40,
      y: Math.sin((i / notes.length) * 2 * Math.PI) * 180 + (Math.random() - .5) * 40,
      vx: 0, vy: 0, deg: 0,
    }));
    const nodeById = new Map(nodes.map((nd) => [nd.id, nd]));
    const edges = [];
    for (const n of notes) {
      for (const link of extractLinks(n.body)) {
        const targetId = byTitle.get(norm(link));
        if (targetId && targetId !== n.id) {
          edges.push({ source: n.id, target: targetId });
          nodeById.get(n.id).deg++;
          nodeById.get(targetId).deg++;
        }
      }
    }
    graph = { nodes, edges, nodeById };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function simulate() {
    const { nodes, edges, nodeById } = graph;
    const k = 0.02, repel = 2600, spring = 0.012, restLen = 90, damping = 0.86;

    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy || 0.01;
        let f = repel / dist2;
        let d = Math.sqrt(dist2);
        a.vx += (dx / d) * f * 0.001;
        a.vy += (dy / d) * f * 0.001;
      }
      // pull to center
      a.vx -= a.x * k * 0.01;
      a.vy -= a.y * k * 0.01;
    }
    for (const e of edges) {
      const a = nodeById.get(e.source), b = nodeById.get(e.target);
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      let f = (d - restLen) * spring;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n === dragNode) continue;
      n.vx *= damping; n.vy *= damping;
      n.x += n.vx; n.y += n.vy;
    }
  }

  function drawGraph() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(r.width / 2 + view.x, r.height / 2 + view.y);
    ctx.scale(view.scale, view.scale);

    // edges
    ctx.strokeStyle = "rgba(124,156,255,0.25)";
    ctx.lineWidth = 1;
    for (const e of graph.edges) {
      const a = graph.nodeById.get(e.source), b = graph.nodeById.get(e.target);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // nodes
    for (const n of graph.nodes) {
      const radius = 5 + Math.min(n.deg, 8) * 1.8;
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = n.id === activeId ? "#7c9cff" : "#6fd3c5";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0f1115";
      ctx.stroke();

      ctx.fillStyle = "#e6e9ef";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      const label = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
      ctx.fillText(label, n.x, n.y + radius + 13);
    }
    ctx.restore();
  }

  function tick() {
    simulate();
    drawGraph();
    rafId = requestAnimationFrame(tick);
  }

  function openGraph() {
    if (notes.length === 0) { toast("Add some notes first"); return; }
    buildGraph();
    graphView.hidden = false;
    $("#graphStats").textContent = `${graph.nodes.length} notes · ${graph.edges.length} links`;
    view = { x: 0, y: 0, scale: 1 };
    resizeCanvas();
    cancelAnimationFrame(rafId);
    tick();
  }
  function closeGraph() { graphView.hidden = true; cancelAnimationFrame(rafId); }

  function nodeAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const mx = (clientX - r.left - r.width / 2 - view.x) / view.scale;
    const my = (clientY - r.top - r.height / 2 - view.y) / view.scale;
    for (const n of graph.nodes) {
      const radius = 5 + Math.min(n.deg, 8) * 1.8 + 4;
      if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= radius * radius) return { node: n, mx, my };
    }
    return null;
  }

  // ---------- Graph interactions ----------
  canvas.addEventListener("mousedown", (e) => {
    const hit = nodeAt(e.clientX, e.clientY);
    if (hit) { dragNode = hit.node; dragNode._moved = false; }
    else { panning = true; }
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", (e) => {
    if (dragNode) {
      const r = canvas.getBoundingClientRect();
      dragNode.x = (e.clientX - r.left - r.width / 2 - view.x) / view.scale;
      dragNode.y = (e.clientY - r.top - r.height / 2 - view.y) / view.scale;
      dragNode.vx = dragNode.vy = 0;
      dragNode._moved = true;
    } else if (panning) {
      view.x += e.clientX - lastMouse.x;
      view.y += e.clientY - lastMouse.y;
      lastMouse = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (dragNode && !dragNode._moved) { closeGraph(); openNote(dragNode.id); }
    dragNode = null; panning = false;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    view.scale = Math.max(0.25, Math.min(4, view.scale * factor));
  }, { passive: false });

  // ---------- Export / Import ----------
  function exportNotes() {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `second-brain-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported " + notes.length + " notes");
  }

  function importNotes(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("bad format");
        let added = 0;
        for (const item of data) {
          if (!item || typeof item.body !== "string") continue;
          const existing = item.id && getNote(item.id);
          if (existing) continue;
          notes.push({
            id: item.id || uid(),
            title: item.title || "Untitled",
            body: item.body,
            created: item.created || Date.now(),
            updated: item.updated || Date.now(),
          });
          added++;
        }
        persist();
        refreshAll();
        toast(`Imported ${added} note${added !== 1 ? "s" : ""}`);
      } catch {
        toast("Import failed — invalid JSON");
      }
    };
    reader.readAsText(file);
  }

  // ---------- Seed examples ----------
  function seed() {
    const now = Date.now();
    const samples = [
      ["Welcome to your Second Brain",
        "# Welcome 👋\n\nThis is your **second brain** — a place to capture ideas and connect them. #start\n\n## How linking works\nStart typing `[[` and an **autocomplete** menu pops up — pick a note to link it, like [[Zettelkasten]].\nIf the note doesn't exist yet, choosing **+ Create** makes it for you.\n\nTry opening the [[Graph View]] to see how everything connects.\n\n## Markdown\n- **bold**, *italic*, `code`\n- > blockquotes\n- lists like this one\n\nSee also: [[Tips & Shortcuts]]"],
      ["Zettelkasten",
        "# Zettelkasten #method\n\nA note-taking method built on small, atomic notes that link to each other. Coined by sociologist Niklas Luhmann.\n\nThe power comes from **connections**, not folders — exactly what [[Welcome to your Second Brain]] is about.\n\nRelated idea: [[Atomic Notes]]."],
      ["Atomic Notes",
        "# Atomic Notes #method\n\nEach note should hold **one idea**. Small notes are easier to link and reuse.\n\nThis is a core principle of the [[Zettelkasten]] method."],
      ["Graph View",
        "# Graph View\n\nThe graph shows every note as a node and every [[wiki-link]] as an edge.\n\nBigger nodes have more connections. **Drag** nodes around, **scroll** to zoom, and **click** a node to jump to that note.\n\nIt's the fastest way to spot clusters and orphan notes."],
      ["Tips & Shortcuts",
        "# Tips & Shortcuts #start\n\n**Tags:** write `#anything` in a note and a tag chip appears in the sidebar — tap it to filter. Try [[Zettelkasten]] which is tagged too.\n\n**Pin:** tap 📌 in the toolbar to keep a note at the top of the list.\n\n**Link fast:** type `[[` for autocomplete.\n\n| Shortcut | Action |\n|---|---|\n| Ctrl/Cmd + N | New note |\n| Ctrl/Cmd + K | Focus search |\n| Ctrl/Cmd + E | Toggle preview |\n| Ctrl/Cmd + G | Toggle graph |\n\nYour data lives entirely in this browser. Use **Export** to back it up as JSON."],
    ];
    notes = samples.map(([title, body], i) => ({
      id: uid(), title, body, created: now - i * 1000, updated: now - i * 1000,
    }));
    activeId = notes[0].id;
    persist();
    refreshAll();
  }

  // ============================================================
  //  EVENT WIRING
  // ============================================================
  function delegated(container, selector, type, handler) {
    container.addEventListener(type, (e) => {
      const el = e.target.closest(selector);
      if (el && container.contains(el)) handler(e, el);
    });
  }

  // Sidebar list click
  delegated(noteList, ".note-item", "click", (_, el) => openNote(el.dataset.id));
  // Backlink click
  delegated(backlinksEl, ".backlink-item", "click", (_, el) => openNote(el.dataset.id));
  // Wiki-link click (in preview)
  delegated(preview, ".wikilink", "click", (e, el) => {
    e.preventDefault();
    navigateToTitle(el.dataset.link);
  });

  titleInput.addEventListener("input", scheduleSave);
  bodyInput.addEventListener("input", () => { scheduleSave(); if (!preview.hidden) updatePreview(); });

  searchInput.addEventListener("input", () => renderList(searchInput.value));

  $("#newNoteBtn").addEventListener("click", () => newNote());
  $("#emptyNewBtn").addEventListener("click", () => newNote());
  $("#seedBtn").addEventListener("click", seed);

  function newNote() {
    flushSaveImmediate();
    createNote("", "");
    refreshAll();
    if (window.matchMedia("(max-width: 760px)").matches) {
      sidebar.classList.remove("open");
      backdrop.classList.remove("show");
    }
    titleInput.focus();
  }

  $("#deleteBtn").addEventListener("click", () => {
    const n = getNote(activeId);
    if (!n) return;
    if (confirm(`Delete “${n.title || "Untitled"}”? This can't be undone.`)) {
      deleteNote(n.id);
      refreshAll();
      toast("Note deleted");
    }
  });

  $("#previewToggle").addEventListener("click", togglePreview);
  function togglePreview() {
    const show = preview.hidden;
    preview.hidden = !show;
    bodyInput.hidden = show;
    if (show) updatePreview();
    $("#previewToggle").textContent = show ? "✎ Edit" : "👁 Preview";
  }

  // ---------- Mobile sidebar toggle ----------
  const sidebar = $("#sidebar");
  const backdrop = $("#backdrop");
  const isMobile = () => window.matchMedia("(max-width: 760px)").matches;
  function openSidebar() { sidebar.classList.add("open"); backdrop.classList.add("show"); }
  function closeSidebar() { sidebar.classList.remove("open"); backdrop.classList.remove("show"); }
  function toggleSidebar() { sidebar.classList.contains("open") ? closeSidebar() : openSidebar(); }
  $("#menuBtn").addEventListener("click", toggleSidebar);
  backdrop.addEventListener("click", closeSidebar);
  // On mobile, picking a note or backlink should reveal the editor.
  noteList.addEventListener("click", () => { if (isMobile()) closeSidebar(); });
  backlinksEl.addEventListener("click", () => { if (isMobile()) closeSidebar(); });

  $("#graphBtn").addEventListener("click", openGraph);
  $("#closeGraph").addEventListener("click", closeGraph);
  $("#exportBtn").addEventListener("click", exportNotes);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importNotes(e.target.files[0]);
    e.target.value = "";
  });

  // ---------- Pin / unpin ----------
  $("#pinBtn")?.addEventListener("click", () => {
    const n = getNote(activeId);
    if (!n) return;
    n.pinned = !n.pinned;
    persist();
    updatePinBtn();
    renderList(searchInput.value);
    toast(n.pinned ? "📌 Pinned" : "Unpinned");
  });

  // ---------- Tag filtering ----------
  $("#tagBar")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".tag-chip");
    if (!chip) return;
    activeTag = norm(activeTag) === norm(chip.dataset.tag) ? null : chip.dataset.tag;
    renderList(searchInput.value);
  });

  // ---------- Wiki-link [[ autocomplete ----------
  const linkAuto = document.createElement("div");
  linkAuto.className = "link-auto";
  linkAuto.hidden = true;
  (document.querySelector(".editor-body") || document.body).appendChild(linkAuto);
  let autoItems = [], autoSel = 0;

  function currentLinkQuery() {
    const pos = bodyInput.selectionStart;
    const before = bodyInput.value.slice(0, pos);
    const open = before.lastIndexOf("[[");
    if (open === -1) return null;
    const between = before.slice(open + 2);
    if (/[\]\n]/.test(between) || between.includes("[[")) return null;
    return { open, query: between, pos };
  }

  function showAuto() {
    const ctx = currentLinkQuery();
    if (!ctx) return hideAuto();
    const q = norm(ctx.query);
    const matches = notes
      .filter((n) => n.id !== activeId && n.title.trim() && norm(n.title).includes(q))
      .slice(0, 6)
      .map((n) => ({ title: n.title, isNew: false }));
    if (ctx.query.trim() && !notes.some((n) => norm(n.title) === q)) {
      matches.push({ title: ctx.query.trim(), isNew: true });
    }
    if (matches.length === 0) return hideAuto();
    autoItems = matches; autoSel = 0;
    renderAuto();
    linkAuto.hidden = false;
  }

  function renderAuto() {
    linkAuto.innerHTML = autoItems.map((m, i) =>
      `<div class="la-item${i === autoSel ? " sel" : ""}" data-i="${i}">` +
      (m.isNew ? `<span class="la-new">+ Create “${escapeHtml(m.title)}”</span>` : escapeHtml(m.title)) +
      `</div>`).join("") +
      `<div class="la-hint">↑↓ navigate · Enter insert · Esc close</div>`;
  }

  function hideAuto() { linkAuto.hidden = true; autoItems = []; }

  function applyAuto(i) {
    const m = autoItems[i];
    const ctx = currentLinkQuery();
    if (!m || !ctx) return hideAuto();
    const val = bodyInput.value;
    bodyInput.value = val.slice(0, ctx.open) + "[[" + m.title + "]]" + val.slice(ctx.pos);
    const caret = ctx.open + m.title.length + 4;
    bodyInput.setSelectionRange(caret, caret);
    hideAuto();
    scheduleSave();
    if (!preview.hidden) updatePreview();
    bodyInput.focus();
  }

  linkAuto.addEventListener("pointerdown", (e) => {
    const item = e.target.closest(".la-item");
    if (item) { e.preventDefault(); applyAuto(+item.dataset.i); }
  });
  bodyInput.addEventListener("input", showAuto);
  bodyInput.addEventListener("click", showAuto);
  bodyInput.addEventListener("blur", () => setTimeout(hideAuto, 150));
  bodyInput.addEventListener("keydown", (e) => {
    if (linkAuto.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); autoSel = (autoSel + 1) % autoItems.length; renderAuto(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); autoSel = (autoSel - 1 + autoItems.length) % autoItems.length; renderAuto(); }
    else if (e.key === "Enter") { e.preventDefault(); applyAuto(autoSel); }
    else if (e.key === "Escape") { e.preventDefault(); hideAuto(); }
  });

  window.addEventListener("resize", () => { if (!graphView.hidden) resizeCanvas(); });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (e.key === "Escape" && !graphView.hidden) closeGraph();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "n") { e.preventDefault(); newNote(); }
    else if (k === "k") { e.preventDefault(); searchInput.focus(); searchInput.select(); }
    else if (k === "e") { e.preventDefault(); togglePreview(); }
    else if (k === "g") { e.preventDefault(); graphView.hidden ? openGraph() : closeGraph(); }
  });

  // ---------- Boot ----------
  const BUILD = "v4";
  const buildBadge = $("#buildBadge");
  if (buildBadge) buildBadge.textContent = "Second Brain " + BUILD;
  load();
  refreshAll();
})();
