# gridclip

**Spreadsheet-grade copy & paste for web apps.** Read what users copy from Excel, Google Sheets, LibreOffice, Word or any web page — merged cells, in-cell line breaks and exact whitespace included — and put cells on the clipboard that paste back into those apps just as faithfully.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![types: included](https://img.shields.io/badge/types-included-blue.svg)
![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![runtimes: browser · node · deno · bun](https://img.shields.io/badge/runs%20on-browser%20%C2%B7%20node%20%C2%B7%20deno%20%C2%B7%20bun-informational.svg)

[한국어 README](./README.ko.md)

```js
import { parseClipboard, setClipboardData } from 'gridclip';

grid.addEventListener('paste', (event) => {
  const { rows, merges } = parseClipboard(event); // string[][] + merged cells
  // …write rows into your table, starting at the selected cell
});

grid.addEventListener('copy', (event) => {
  setClipboardData(event, selectedCells, { merges }); // TSV + HTML table
});
```

![gridclip demo: a small spreadsheet with a merged title row, multi-line cells and Korean text](./docs/demo.png)

---

## Why

Every data grid, admin panel and spreadsheet-like UI eventually gets the same bug reports:

- *"I pasted from Excel and a cell with a line break split into two rows."* — TSV quotes cells containing line breaks, and `text.split('\n')` doesn't know that.
- *"Merged cells come out shifted."* — merges only exist in the clipboard's **HTML** flavour, and turning `<td rowspan=2 colspan=3>` into grid positions takes the full HTML table algorithm.
- *"Copying from your app into Excel puts everything in one column / breaks lines into rows / garbles Korean."* — Excel needs a specific TSV quoting, `<br style="mso-data-placement:same-cell">` for in-cell breaks, and a charset declaration in the HTML.
- *"Pasting a value into a selection should fill it, like in Sheets."*

gridclip solves the whole round trip with one small, dependency-free library that runs in the browser **and** on the server (no DOM needed).

## Features

- **Reads what people actually paste**: Excel, Google Sheets, LibreOffice Calc, Word and web pages (each covered by test fixtures), plus anything else that puts TSV or an HTML table on the clipboard — Numbers, Notion, Airtable, other data grids, plain text.
- **Merged cells**: a complete, DOM-free implementation of the HTML table model — `colspan`/`rowspan`, `rowspan="0"`, implied `<tr>`/`<tbody>`, spans clipped at row-group boundaries, nested tables, unclosed tags. Excel's quirks are handled too: `mso-ignore:colspan` overflow is not a merge, the hidden `supportMisalignedColumns` row is skipped, and `mso-spacerun` spaces are kept.
- **Best of both flavours**: when the TSV and the HTML table agree in shape, cell values come from the exact TSV (whitespace intact) and merges come from the HTML. When they disagree — rich-text apps whose plain text breaks rows at in-cell line breaks — the HTML wins.
- **Writes clipboard data that pastes back correctly** into Excel, Sheets, LibreOffice, Word and rich-text editors: properly quoted TSV and an HTML table with merges, in-cell line breaks, preserved whitespace and `<meta charset="utf-8">` (so Excel on Windows doesn't garble non-ASCII text).
- **Clipboard APIs with fallbacks**: `copy`/`cut`/`paste` events (DOM or React), the Async Clipboard API, the `execCommand('copy')` fallback, and `writeText`.
- **Spreadsheet paste semantics**: `applyPaste` tiles a block into a larger selection (one value fills the range, a 1×2 block repeats across a 3×4 range, …), grows the grid or clips at its edges, and never mutates your data.
- **Safe on hostile input**: linear-time parsers and a `maxCells` guard against "paste bombs" (a few bytes of `<td colspan=1000>` repeated).
- **Tiny and tree-shakable**: zero dependencies, ESM + CommonJS + `<script>` builds, full TypeScript types. 10.8 kB min+gzip for everything; `parseTSV`/`stringifyTSV` alone is 1.4 kB.

## Install

```sh
npm install gridclip
# or: pnpm add gridclip · yarn add gridclip · bun add gridclip
```

Deno: `import { parseClipboard } from 'npm:gridclip';`

Without a bundler:

```html
<script src="https://unpkg.com/gridclip"></script>
<script>
  const { parseClipboard } = window.gridclip;
</script>
```

## Quick start

### Paste into your grid

```js
import { parseClipboard, applyPaste } from 'gridclip';

document.addEventListener('paste', (event) => {
  if (document.activeElement !== gridElement) return;
  const { rows } = parseClipboard(event);
  if (rows.length === 0) return; // e.g. an image was pasted
  event.preventDefault();

  // selection = { row, col, rows, cols } of the selected range
  const { grid, range } = applyPaste(data, rows, selection);
  data = grid;           // a new array; the old one is untouched
  select(range);         // the block that was written
});
```

> Clipboard events go to the focused element only if it is editable. A grid made of non-editable cells should listen on `document` (as above) and check that it has focus.

### Copy from your grid

```js
import { setClipboardData, sliceGrid } from 'gridclip';

document.addEventListener('copy', (event) => {
  if (document.activeElement !== gridElement) return;
  setClipboardData(event, sliceGrid(data, selection)); // calls preventDefault()
});
```

### Copy and paste from buttons

```js
import { copyToClipboard, readFromClipboard } from 'gridclip';

copyButton.onclick = async () => {
  const method = await copyToClipboard(rows, { merges }); // 'clipboard-api' | 'exec-command' | 'write-text'
};

pasteButton.onclick = async () => {
  const { rows, merges } = await readFromClipboard(); // the browser may ask for permission
};
```

### React

React's synthetic clipboard events work as they are:

```jsx
function Grid({ data, selection, onChange }) {
  return (
    <div
      tabIndex={0}
      onCopy={(e) => setClipboardData(e, sliceGrid(data, selection))}
      onPaste={(e) => {
        const { rows } = parseClipboard(e);
        if (!rows.length) return;
        e.preventDefault();
        onChange(applyPaste(data, rows, selection).grid);
      }}
    >
      {/* … */}
    </div>
  );
}
```

### Vue

```vue
<div tabindex="0" @copy="setClipboardData($event, sliceGrid(data, selection))" @paste="onPaste">…</div>
```

### On the server

Everything except `copyToClipboard`/`readFromClipboard` is pure and works in Node, Deno, Bun, workers and edge runtimes — for example to import pasted HTML or TSV that a client sent you:

```js
import { parseHTMLTable, parseTSV } from 'gridclip';

const table = parseHTMLTable(htmlFromClient, { maxCells: 100_000 });
const rows = parseTSV(csvText, { delimiter: ',' });
```

## Try it

Build the package and open the demo, a small spreadsheet you can paste into from Excel or Sheets and copy back out of:

```sh
npm install && npm run build
npx http-server . -o examples/demo.html   # any static server works
```

## API

All functions validate their arguments and throw a `TypeError` or `RangeError` with a message starting with `gridclip:` on invalid input.

| Function | What it does |
| --- | --- |
| [`parseClipboard(source, options?)`](#parseclipboardsource-options) | Reads pasted cells from an event, `DataTransfer` or `{ text, html }` |
| [`setClipboardData(target, grid, options?)`](#setclipboarddatatarget-grid-options) | Writes cells inside a `copy`/`cut` handler |
| [`copyToClipboard(grid, options?)`](#copytoclipboardgrid-options) | Writes cells to the system clipboard (async) |
| [`readFromClipboard(options?)`](#readfromclipboardoptions) | Reads cells from the system clipboard (async) |
| [`parseTSV(text, options?)`](#parsetsvtext-options) | Parses tab- (or comma-) separated text |
| [`stringifyTSV(grid, options?)`](#stringifytsvgrid-options) | Serialises cells as spreadsheet-compatible TSV/CSV |
| [`parseHTMLTable(html, options?)`](#parsehtmltablehtml-options) | Extracts the first `<table>` of any HTML, with merges |
| [`stringifyHTMLTable(grid, options?)`](#stringifyhtmltablegrid-options) | Serialises cells as an HTML table |
| [`stringifyClipboard(grid, options?)`](#stringifyclipboardgrid-options) | Both flavours at once: `{ text, html }` |
| [`applyPaste(grid, data, options?)`](#applypastegrid-data-options) | Pastes a block into a grid with spreadsheet semantics |
| [`sliceGrid(grid, range, fill?)`](#slicegridgrid-range-fill) | Copies a rectangular block out of a grid |

Types used below:

```ts
type Grid<T = string> = T[][];
type ReadonlyGrid<T = unknown> = ReadonlyArray<ReadonlyArray<T>>;
interface MergeRange { row: number; col: number; rowSpan: number; colSpan: number } // zero-based
interface CellRange { row: number; col: number; rows: number; cols: number }
```

### `parseClipboard(source, options?)`

Reads the cells a user is pasting.

- `source` — a `ClipboardEvent` (DOM or React), a `DragEvent`, a `DataTransfer`, or `{ text?: string, html?: string }`.
- Returns `{ rows: string[][], merges: MergeRange[], source: 'html' | 'text' | 'none' }`. `rows` is always rectangular. It is empty (and `source` is `'none'`) when there was nothing textual to paste, e.g. a file or an image. `source` names the flavour the **values** came from; merges always come from the HTML.

Accepts every option of [`parseTSV`](#parsetsvtext-options) and [`parseHTMLTable`](#parsehtmltablehtml-options), plus:

| Option | Default | |
| --- | --- | --- |
| `prefer` | `'auto'` | `'auto'`: use the HTML table only when the HTML contains nothing but that table (what spreadsheets put on the clipboard). If its shape matches the plain text, take the values from the text and the merges from the HTML; if not, take everything from the HTML. When the HTML has other content too, e.g. a paragraph and a table selected on a web page, use the text the user actually selected. `'html'`: always use the first HTML table if there is one. `'text'`: always use the text if there is some. In every mode the other flavour is the fallback. |

If you pass a `cell` mapper, values are read from the HTML, because that's where the attributes are.

### `setClipboardData(target, grid, options?)`

Writes `grid` as `text/plain` (TSV) and `text/html` (table) inside a `copy` or `cut` handler and calls `event.preventDefault()`. `target` is the event (DOM or React) or its `DataTransfer`. Returns the `{ text, html }` that was written. Accepts the options of [`stringifyClipboard`](#stringifyclipboardgrid-options).

### `copyToClipboard(grid, options?)`

Copies `grid` to the system clipboard with both flavours. Call it from a user gesture (click, key press). It tries, in order:

1. `navigator.clipboard.write()` with a `ClipboardItem`, for both flavours;
2. `document.execCommand('copy')`, for both flavours, in older browsers and non-secure (`http:`) pages. The current selection and focus are restored afterwards;
3. `navigator.clipboard.writeText()`, text only.

It resolves with the method that worked (`'clipboard-api' | 'exec-command' | 'write-text'`) and rejects with an `Error` whose `cause` is the browser's error when none worked.

### `readFromClipboard(options?)`

Reads the system clipboard with `navigator.clipboard.read()`, falling back to `readText()`, and parses it like `parseClipboard`. The Async Clipboard API needs a secure context; browsers may show a permission prompt or require a user gesture. Rejects when reading is impossible.

### `parseTSV(text, options?)`

Parses tab-separated text the way spreadsheets write it.

- A cell that starts with `"` is unquoted (`""` → `"`) **only if** its closing quote is followed by a delimiter, a line break or the end of the input. Any other quote is kept literally, so `5" ruler` and `"Hi" she said` survive untouched.
- `\r\n`, `\n` and `\r` all end a row. One trailing line ending is ignored (Excel terminates the last row), so `'a\n'` is one row but `'a\n\n'` is two.
- A leading byte order mark is removed.
- Runs in linear time, even on pathological input.

| Option | Default | |
| --- | --- | --- |
| `delimiter` | `'\t'` | Any single character except `"`, `\r`, `\n`. Use `','` for CSV. |
| `rectangular` | `true` | Pad short rows with `''`. |
| `normalizeNewlines` | `true` | Turn `\r\n`/`\r` inside quoted cells into `\n`. |

### `stringifyTSV(grid, options?)`

The inverse of `parseTSV`: `parseTSV(stringifyTSV(grid))` returns `grid` for any rectangular grid of strings (property-tested). A cell is quoted when it contains the delimiter or a line break, or starts with `"` or a byte order mark. `null`/`undefined` become empty cells, `Date`s become ISO strings, everything else goes through `String()`.

| Option | Default | |
| --- | --- | --- |
| `delimiter` | `'\t'` | As above. |
| `lineEnding` | `'\n'` | Or `'\r\n'`. |
| `trailingNewline` | `false` | End the last row with a line ending, too. A grid whose last row is one empty cell always gets one; otherwise that row couldn't be told apart from no row. |

### `parseHTMLTable(html, options?)`

Extracts the first `<table>` of an HTML document or fragment as `{ rows: string[][], merges: MergeRange[] }`, or returns `null` when there is no table. It follows the HTML specification's tokenizer and table model and has been verified against Chromium on tens of thousands of generated tables (see [Testing](#testing)).

Cell text is what a user sees:

- CSS white-space rules apply: collapsing, `<pre>`, `white-space: pre | pre-wrap | pre-line | break-spaces`, and Excel's `mso-spacerun`.
- `<br>` and block elements (`<p>`, `<div>`, `<li>`, …) become line breaks.
- Hidden content is skipped: `display:none`, `hidden`, `<script>`, `<style>`, `<template>`.
- Office conditional comments are handled.
- Nested tables are flattened into their cell: cells separated by spaces, rows by line breaks.
- A final `<br>` does not add an empty last line. That is also why LibreOffice's `<td><br></td>` reads as an empty cell.

| Option | Default | |
| --- | --- | --- |
| `mergedCells` | `'empty'` | Slots covered by a merge are `''`. Use `'repeat'` to copy the merged value into every slot. |
| `preserveNbsp` | `false` | Keep U+00A0 instead of turning it into a space. By default a line made only of `&nbsp;` (the classic `<td>&nbsp;</td>`) reads as empty. |
| `cell` | — | `(cell) => string \| undefined`: override a cell's value. Receives `{ text, tag, attributes, row, col, rowSpan, colSpan }`. Return `undefined` to keep the text. |
| `maxCells` | `5_000_000` | Throw a `RangeError` when rows × columns would exceed this. |

**Reading raw values.** Spreadsheets put formatted text in cells (`1,234.50`, `$3,703.50`), but they often attach the raw value as an attribute:

```js
// Excel: <td x:num="1234.5">1,234.50</td>
parseHTMLTable(html, { cell: ({ attributes }) => attributes['x:num'] || undefined });

// Google Sheets: <td data-sheets-value='{"1":3,"3":1234.5}'>$1,234.50</td>
parseHTMLTable(html, {
  cell: ({ attributes }) => {
    const raw = attributes['data-sheets-value'];
    if (!raw) return undefined;
    const value = JSON.parse(raw); // {"1": type, "2": string, "3": number, "4": boolean}
    return String(value['3'] ?? value['2'] ?? value['4']);
  },
});

// LibreOffice: <td sdval="9411000">9411000</td>
parseHTMLTable(html, { cell: ({ attributes }) => attributes.sdval });
```

These attributes are undocumented app internals, so treat them as best effort.

### `stringifyHTMLTable(grid, options?)`

Serialises a grid as an HTML table for the `text/html` flavour:

- markup is escaped;
- line breaks become `<br style="mso-data-placement:same-cell">`, so Excel keeps them inside the cell;
- cells with significant whitespace get `white-space:pre-wrap`;
- the output starts with `<meta charset="utf-8">`.

`parseHTMLTable(stringifyHTMLTable(grid))` returns `grid` (property-tested).

| Option | Default | |
| --- | --- | --- |
| `merges` | `[]` | Emitted as `rowspan`/`colspan`. Must lie inside the grid and must not overlap, otherwise a `RangeError` is thrown. |
| `headerRows` | `0` | Number of leading rows rendered as `<th>`. |

### `stringifyClipboard(grid, options?)`

Returns `{ text, html }`, i.e. `stringifyTSV` and `stringifyHTMLTable` together. Accepts the options of both.

### `applyPaste(grid, data, options?)`

Pastes `data` into `grid` and returns `{ grid, range }`: a **new**, rectangular grid and the block of cells that was written. Neither input is modified. Works with any cell type.

| Option | Default | |
| --- | --- | --- |
| `row`, `col` | `0` | Top-left target cell. |
| `rows`, `cols` | — | Size of the selected range. If it is a multiple of the pasted block in both directions, the block is repeated to fill it (Excel/Sheets behaviour). Otherwise it is pasted once. |
| `grow` | `true` | Let the grid grow to fit. `false` clips at the edges; `'rows'` or `'cols'` grows in one direction only. |
| `fill` | `''` | Value for new slots and for slots missing from ragged rows. |

```js
applyPaste([['a', 'b'], ['c', 'd']], [['X']], { rows: 2, cols: 2 }).grid; // [['X','X'],['X','X']]
applyPaste([['a']], [['1', '2']], { row: 1, col: 1 }).grid;               // [['a','',''],['','1','2']]
applyPaste([['a', 'b']], [['1', '2', '3']], { grow: false }).grid;        // [['1','2']]
```

### `sliceGrid(grid, range, fill?)`

Copies the block `range = { row, col, rows, cols }` out of `grid`. Slots outside the grid become `fill` (default `''`).

## Behaviour notes

- **Which flavour wins?** With the default `prefer: 'auto'`, spreadsheets (whose TSV and HTML table always line up) give values from the TSV and merges from the HTML. Word and web pages usually give values from the HTML table, because their plain text doesn't line up with the cells — a caption line, or unquoted in-cell line breaks.
- **Ambiguous trailing newline.** Spreadsheets end the last row with a line ending; gridclip therefore drops exactly one. A clipboard text of `"a\n"` is the single cell `a`.
- **Only the first table** of an HTML fragment is read. Tables inside hidden elements and `<template>` are ignored, and so are captions.
- **Hidden rows** that a spreadsheet includes in the clipboard are included, consistent with its plain text. (Excel's own invisible `supportMisalignedColumns` helper row is skipped.)
- **Formulas, formats and styles** are not part of the grid. Read them through the `cell` option if you need them.

## Compatibility

| Environment | Support |
| --- | --- |
| Chrome / Edge / Opera | Everything, verified by the automated browser tests (Chromium). |
| Firefox, Safari (macOS, iOS) | Parsing and serialising are plain JavaScript and behave identically everywhere. The clipboard calls are feature-detected: browsers with `ClipboardItem` (Firefox 127+, Safari 13.1+) get both flavours through `navigator.clipboard.write()`, older ones fall back to `execCommand('copy')`, which writes both flavours too. In Safari, call `copyToClipboard`/`readFromClipboard` directly inside the click handler. |
| Non-secure pages (`http:`) | `copy`/`paste` events and `copyToClipboard` (via `execCommand`) work; `readFromClipboard` needs HTTPS. |
| Node.js 14+, Deno, Bun, workers, edge | All pure functions (parsing, serialising, `applyPaste`). The two async clipboard functions reject with a clear error. |
| TypeScript | Types for ESM and CommonJS, any `moduleResolution` (`node10`, `node16`, `bundler`). |

The parsers use nothing beyond ES2018/ES2020 built-ins.

## Testing

gridclip is tested at several levels (`npm run check` runs them all):

- **Unit tests** (Vitest): about 300 cases, including clipboard HTML fixtures modelled on Excel for Windows, Google Sheets, LibreOffice, Word and a web-page table. Line coverage is 100%.
- **Property-based tests** (fast-check): TSV and HTML round-trips over arbitrary Unicode, including lone surrogates, control characters, quotes, tabs and line breaks, for every delimiter and line-ending combination. Also fuzzing for crashes and invariants (rectangular output, non-overlapping merges) and a reference model for `applyPaste`.
- **Differential tests against Chromium**: generated tables are parsed by gridclip and by the browser, then compared.
  - Cell positions and spans are checked against the browser's actual **layout**.
  - Fuzzed malformed markup is checked against the browser's **tree builder**.
  - Character references are checked in text and attributes.
  - Cell text is checked against `innerText` (exact match for inline content, line-by-line where `innerText` adds line breaks that don't render).
- **End-to-end tests** with the real system clipboard in Chromium (the browser available in CI): keyboard copy and paste, cut, pasting into `<textarea>` and `contenteditable`, the Async Clipboard API, and the `execCommand`/`writeText` fallbacks. Also the demo app, driven like a user would.
- **Runtimes and packaging**: smoke tests of the built ESM and CommonJS packages on Node 14, 16, 18, 20, 22 and 24, Bun and Deno. Type tests against the published declarations under `node10`, `node16` and `bundler` resolution. `publint` and `@arethetypeswrong/cli`.

## License

[MIT](./LICENSE)
