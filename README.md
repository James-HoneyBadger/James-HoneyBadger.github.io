# James HoneyBadger · GitHub Pages

A two-page static site with no framework, no runtime dependencies and no build step for the pages
themselves.

- `index.html` — pinned repositories from `@James-HoneyBadger` (owned by that account only), ordered by
  stars (desc).
- `repos.html` — every public, non-fork repository owned by `@James-HoneyBadger`, with search, a
  language filter, six sort orders and shareable filter URLs.

Both pages are rendered in the browser from JSON snapshots, so they need JavaScript for the lists;
without it the pages explain themselves and link to GitHub.

## Layout

```
index.html, repos.html   markup only; no inline CSS or JS
404.html                 branded not-found page (root-absolute paths)
styles.css               all styling, both colour schemes, self-hosted @font-face
sitemap.xml, robots.txt  crawl hints for the two real pages
assets/shared.js         escaping, URL safety, dates, cache, fetch, card fragments
assets/repos.js          the directory: filters, sorts, URL state, cache, errors
assets/index.js          the highlights page
assets/fonts/            Space Grotesk (SIL OFL 1.1, licence in OFL.txt)
data/pinned.json         generated: pinned repositories
data/repos.json          generated: the full repository list
hb.avif / hb.webp / hb.jpg   hero image (AVIF → WebP → JPEG fallback)
scripts/                 data generators and the validator
```

## Data pipeline

`.github/workflows/update-pinned.yml` ("Refresh site data") runs every 6 hours and on demand. It
regenerates both JSON files and commits them only when something changed — a quiet run produces no
commit and no Pages rebuild, because `generatedAt` is not refreshed on its own.

Both generators refuse to write an empty list: an empty result almost always means the API or the
account changed shape, and shipping `[]` would blank the site. `npm run check` enforces the same
floor on the committed files.

The GitHub GraphQL API needs an authenticated caller. The workflow uses the `PINNED_REPOS_TOKEN`
secret when present and otherwise falls back to the repo-scoped `GITHUB_TOKEN`, which does read
`pinnedItems` for a public profile (verified against this repo), so a PAT is optional.

Running the generators locally:

```bash
GITHUB_TOKEN=<token> node scripts/update-pinned.mjs   # GraphQL: pinned items
node scripts/update-repos.mjs                          # REST: all owned repos, no token needed
```

Overrides: `GH_PINNED_USER`, `GH_PINNED_OUT` (`data/pinned.json`), `GH_REPOS_OUT` (`data/repos.json`).

The directory page reads `data/repos.json` first, falls back to the live REST API if that file is
missing, and caches the result in `localStorage` for 30 minutes.

## Local development

Any static server works:

```bash
python3 -m http.server 8000
```

Tooling (`npm ci` once):

- `npm run lint` — ESLint over `assets/` and `scripts/` (recommended rules only, so it never
  fights Prettier)
- `npm run check` — markup, styles, data shape, asset references, JS syntax, JSON-LD, sitemap,
  robots, and a 140 KB budget on the shipped HTML/CSS/JS
- `npm run format` / `npm run format:check` — Prettier
- `npm run data` — regenerate both JSON files

`.github/workflows/validate.yml` runs the checks on every pull request and on `main`.

## Directory behaviour

- Search matches name, description, topics and language; it is debounced by 150 ms.
- Filters are reflected in the URL (`?q=`, `?lang=`, `?sort=`) and restored on load.
- `/` focuses the search box, `Esc` clears it.
- Sort orders: recently pushed, newest, most stars, most forks, name A→Z, name Z→A.
- Dates are relative ("3 days ago") with the exact UTC date in the tooltip.

## Notes

- No third-party requests: fonts are self-hosted, so there is no Google Fonts dependency.
- Dark and light palettes both follow `prefers-color-scheme`; every text pairing passes WCAG AA,
  with the lowest light-mode ratio at 4.9:1 (links on the page background) and 6.9:1 in dark mode.
- Both content pages carry JSON-LD (`ProfilePage` on the highlights, `CollectionPage` on the
  directory) and `sitemap.xml` lists only the two real pages; `404.html` is `noindex`.
- Prettier does not format the generated `data/*.json` files (see `.prettierignore`).

Site: https://james-honeybadger.github.io
