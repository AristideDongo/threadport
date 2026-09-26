# ThreadPort website

Static site with no build step, live at https://threadport-io.vercel.app. Vercel deploys `main` using the root `vercel.json` (no install, no build, output `website/`) and posts a preview on every pull request.

Preview locally (ES modules need HTTP, not `file://`):

```bash
python3 -m http.server --directory website 4173
```

- `index.html` (home) and `docs.html` hold the English copy; `i18n.js` holds the French strings keyed by `data-i18n`. The docs page ships one `<article data-lang>` per language.
- `shared.js` handles language, theme, copy buttons, the mobile menu, the GitHub star count and the npm version (both cached per tab; hidden if the API is unreachable). `main.js` and `docs.js` hold page-specific behaviour.
- `og-image.png` is the social preview (1200×630). `404.html` is served by Vercel for unknown paths.
- `context-packs.js` is real `threadport context --mode <mode>` output from a demo session. Regenerate it with the CLI rather than editing it.
- Design: cool paper, navy ink, a teal thread; amber marks only where the thread meets a terminal.
- Motion follows the thread: the hero types a handoff from Claude Code to Codex (replayable), a gutter line fills as you scroll and lights a port per section, the handoff steps fill their rail, the secret in the privacy example is scrambled into `[REDACTED]`, and the token count animates between modes. All of it is skipped with `prefers-reduced-motion`, and the finished state is in the HTML for visitors without JavaScript.
- Fonts are self-hosted in `fonts/` (Bricolage Grotesque, IBM Plex Sans, JetBrains Mono; SIL Open Font License, see `fonts/OFL.txt`), latin and latin-ext subsets only. No request goes to Google Fonts.
- `sitemap.xml`, `robots.txt`, the canonical links and `og:image` use the production URL above; update them if the domain changes.
- `media/threadport.png` and `media/threadport.svg` are copies of `apps/vscode-extension/media/`, the brand logo shared with the extension. Update both places together. The hero thread takes its two end colours from the logo (cyan start, violet end).
