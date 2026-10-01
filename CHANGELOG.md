# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- `stringifyHTMLTable` (and so `setClipboardData`/`copyToClipboard`): leading, trailing and repeated spaces survive pasting into Excel. Excel ignores CSS `white-space` on paste, so these spaces are now also written as Excel's own `<span style="mso-spacerun:yes">&nbsp;…</span>`, which Excel restores as plain spaces (verified with Excel for Windows).
- `parseHTMLTable` with `preserveNbsp: true`: the no-break spaces inside an `mso-spacerun` are read as plain spaces, as Excel itself does, instead of being kept as U+00A0.

### Added

- Clipboard data captured from real Excel for Windows as test fixtures, and `examples/clipboard-capture.html` to capture more.
- Browser tests run in Chromium, Firefox and WebKit (`npm run test:browser:<engine>`), and CI runs them on Linux and Windows.

## [1.0.0] - 2026-10-01

### Added

- `parseClipboard`, `setClipboardData`, `stringifyClipboard`: read and write both clipboard flavours (TSV and HTML table), combining exact TSV values with HTML merges.
- `copyToClipboard`, `readFromClipboard`: Async Clipboard API with `execCommand` and `writeText` fallbacks.
- `parseTSV`, `stringifyTSV`: spreadsheet-compatible TSV/CSV with round-trip guarantees.
- `parseHTMLTable`, `stringifyHTMLTable`: DOM-free HTML table model with merged cells, Excel/Sheets/LibreOffice/Word quirks, CSS white-space handling and a `maxCells` guard.
- `applyPaste`, `sliceGrid`: spreadsheet paste semantics (tiling, growing, clipping).
- ESM, CommonJS and IIFE (`<script>`) builds with TypeScript declarations.
