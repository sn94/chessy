# AGENTS.md

## Run

No build step, no dependencies. Open `index.html` directly in a browser (`file://` works).
To serve locally: `npx serve .` or any static server.

## Architecture

Single-page chess game in three files: `index.html`, `styles.css`, `script.js`.

`script.js` has two sections sharing one file:

1. **Engine** (top) — pure chess rules, no DOM access. Exports for Node via a guarded
   `module.exports` at the bottom.
2. **UI** (bottom) — rendering, drag & drop, effects. Bootstrapped by a guarded
   `if (typeof document !== 'undefined') initUI()`.

**Do not remove the `typeof document` / `typeof module` guards** — they are what make the
engine testable under Node while keeping the file browser-runnable as a plain script.

## Verify

```bash
node --check script.js        # syntax
```

The engine can be exercised headlessly (it is requireable):

```bash
node -e "const {Game}=require('./script.js'); const g=new Game(); console.log(g.legalMoves(6,4).length)"
```

There is no test framework or lint config; verification is ad-hoc Node scripts.

Open chrome to make a visual verification

## Conventions

- Theming is done exclusively through CSS custom properties on `:root`
  (`--light`, `--dark`, `--piece-white`, `--piece-black`). The color pickers write these
  and persist to `localStorage` under the key `chessy.colors`.
- Pieces are Unicode glyphs (filled set) for both colors, differentiated by CSS
  `color` + `-webkit-text-stroke`. No images, no SVG, no web fonts.
- Board orientation is fixed: white on bottom, no flip.
