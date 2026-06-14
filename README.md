# 🧠 Second Brain

A **local-first** note-taking app for connected thinking — wiki-links, backlinks,
full-text search, and an interactive knowledge graph. No backend, no accounts,
no build step. Your notes never leave your browser.

> Built in a single focused session. Open `index.html` and start thinking.

## ✨ Features

- **`[[Wiki-links]]` with autocomplete** — start typing `[[` and pick a note from a
  dropdown (or create a new one). Click a link to jump there. Aliases: `[[Note|label]]`.
- **Tags** — write `#anything` in a note; tap a tag chip in the sidebar to filter.
- **Pin notes** — keep important notes at the top of the list.
- **Backlinks** — every note shows which other notes point to it, with context snippets.
- **Knowledge graph** — a force-directed view of your whole brain. Drag nodes,
  scroll to zoom, click to open. Bigger nodes = more connections.
- **Full-text search** — instant, ranked search across titles and bodies (`Ctrl/Cmd + K`).
- **Markdown** — headings, **bold**, *italic*, `code`, code blocks, lists,
  blockquotes, tables, links, and a live preview.
- **Local-first & private** — everything is stored in `localStorage`. Nothing is sent anywhere.
- **Export / Import** — back up or move your brain as a single JSON file.

## 🚀 Run it

It's a static site — no dependencies, no install.

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in your browser. To publish, drop the three
files on **GitHub Pages**, Netlify, or any static host.

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + N` | New note |
| `Ctrl/Cmd + K` | Focus search |
| `Ctrl/Cmd + E` | Toggle edit / preview |
| `Ctrl/Cmd + G` | Toggle graph view |
| `Esc` | Close graph |

## 📁 Project structure

| File | Purpose |
|---|---|
| `index.html` | Layout & markup |
| `styles.css` | Dark, responsive UI |
| `app.js` | State, markdown renderer, search, backlinks, force-directed graph |

## 🔒 Your data

Notes live under the `second-brain.notes.v1` key in your browser's
`localStorage`. Clearing site data wipes them — use **Export** to keep a backup.

---

First run? Click **Load example notes** on the empty screen to see how linking
and the graph work.
