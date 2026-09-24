# ThreadPort website

Static site with no build step. Vercel serves it from `main` using the root `vercel.json` (no install, no build, output `website/`); `.github/workflows/pages.yml` can also publish it to GitHub Pages.

Preview locally (ES modules need HTTP, not `file://`):

```bash
python3 -m http.server --directory website 4173
```

- `index.html` holds the English copy; `i18n.js` holds the French translation keyed by `data-i18n`.
- `context-packs.js` is real `threadport context --mode <mode>` output from a demo session. Regenerate it with the CLI rather than editing it.
- Design: cool paper, navy ink, a teal thread; amber marks only where the thread meets a terminal. The hero handoff animation is the page's only non-interactive motion and is skipped with `prefers-reduced-motion`.
