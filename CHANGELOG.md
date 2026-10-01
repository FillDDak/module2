# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-01

### Added

- `parseClipboard`, `setClipboardData`, `stringifyClipboard`: read and write both clipboard flavours (TSV and HTML table), combining exact TSV values with HTML merges.
- `copyToClipboard`, `readFromClipboard`: Async Clipboard API with `execCommand` and `writeText` fallbacks.
- `parseTSV`, `stringifyTSV`: spreadsheet-compatible TSV/CSV with round-trip guarantees.
- `parseHTMLTable`, `stringifyHTMLTable`: DOM-free HTML table model with merged cells, Excel/Sheets/LibreOffice/Word quirks, CSS white-space handling and a `maxCells` guard.
- `applyPaste`, `sliceGrid`: spreadsheet paste semantics (tiling, growing, clipping).
- ESM, CommonJS and IIFE (`<script>`) builds with TypeScript declarations.
