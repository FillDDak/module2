import { scanHTML, validateHTMLOptions, type ParseHTMLTableOptions } from './html/table';
import { stringifyHTMLTable, type StringifyHTMLTableOptions } from './html/stringify';
import { parseTSV, resolveDelimiter, stringifyTSV, type ParseTSVOptions, type StringifyTSVOptions } from './tsv';
import type { Grid, MergeRange, ReadonlyGrid } from './types';
import { describe } from './util';

/** Anything that exposes clipboard data: a `DataTransfer`, or plain strings. */
export interface DataTransferLike {
  getData(format: string): string;
}

/** Plain clipboard contents, e.g. from `navigator.clipboard.read()` or a test. */
export interface ClipboardContents {
  text?: string | null;
  html?: string | null;
}

/**
 * Accepted by {@link parseClipboard}: a `ClipboardEvent` (DOM or React), a
 * `DragEvent`, a `DataTransfer`, or `{ text, html }` strings.
 */
export type ClipboardSource =
  | { clipboardData: DataTransferLike | null }
  | { dataTransfer: DataTransferLike | null }
  | DataTransferLike
  | ClipboardContents;

export interface ParseClipboardOptions extends ParseTSVOptions, ParseHTMLTableOptions {
  /**
   * Which flavour to read when both are present.
   *
   * - `'auto'` — use the HTML table when the HTML consists of a table only
   *   (what spreadsheets put on the clipboard), so merged cells survive;
   *   otherwise use the plain text. Copying a paragraph *and* a table from a
   *   web page therefore yields the text the user actually selected.
   * - `'html'` — use the first HTML table whenever there is one.
   * - `'text'` — use the plain text whenever there is some.
   *
   * Whatever the preference, the other flavour is used when the preferred
   * one is missing or empty.
   * @default 'auto'
   */
  prefer?: 'auto' | 'html' | 'text';
}

export interface ClipboardGrid {
  /** The pasted cells. Empty when the clipboard held no text at all. */
  rows: Grid;
  /** Merged cells (only ever reported for HTML tables). */
  merges: MergeRange[];
  /**
   * Which clipboard flavour the cell values were read from. Merged cells are
   * always taken from the HTML flavour, even when the values come from text.
   */
  source: 'html' | 'text' | 'none';
}

export interface StringifyClipboardOptions extends StringifyTSVOptions, StringifyHTMLTableOptions {}

export interface ClipboardPayload {
  /** `text/plain` flavour: tab-separated values. */
  text: string;
  /** `text/html` flavour: an HTML table. */
  html: string;
}

function readData(data: DataTransferLike, format: string): string {
  try {
    const value = data.getData(format);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function resolveContents(source: ClipboardSource): { text: string; html: string } {
  if (source === null || typeof source !== 'object') {
    throw new TypeError(
      `gridclip: parseClipboard expects a ClipboardEvent, DataTransfer or { text, html } object, received ${describe(source)}`,
    );
  }
  let data: DataTransferLike | null | undefined;
  if ('clipboardData' in source) data = source.clipboardData;
  else if ('dataTransfer' in source) data = source.dataTransfer;
  else if (typeof (source as DataTransferLike).getData === 'function') data = source as DataTransferLike;
  else {
    const { text, html } = source as ClipboardContents;
    return { text: typeof text === 'string' ? text : '', html: typeof html === 'string' ? html : '' };
  }
  if (!data) return { text: '', html: '' };
  // 'Text' is the legacy alias still used by some embedded webviews.
  return { text: readData(data, 'text/plain') || readData(data, 'Text'), html: readData(data, 'text/html') };
}

/**
 * Reads the cells a user is pasting. Understands what Excel, Google Sheets,
 * LibreOffice, Word and web pages put on the clipboard, and anything else
 * that provides TSV or an HTML table.
 *
 * With the default `prefer: 'auto'`, both flavours are combined for the most
 * faithful result: when the plain text and the HTML table have the same
 * shape (as with every spreadsheet), the exact values come from the text and
 * the merged cells from the HTML; when they disagree (web pages, rich-text
 * apps whose plain text breaks rows at in-cell line breaks), the HTML table
 * is used.
 *
 * @example
 * element.addEventListener('paste', (event) => {
 *   const { rows, merges } = parseClipboard(event);
 *   if (rows.length) { event.preventDefault(); insert(rows); }
 * });
 */
export function parseClipboard(source: ClipboardSource, options: ParseClipboardOptions = {}): ClipboardGrid {
  const prefer = options.prefer ?? 'auto';
  if (prefer !== 'auto' && prefer !== 'html' && prefer !== 'text') {
    throw new TypeError(`gridclip: prefer must be 'auto', 'html' or 'text', received ${describe(prefer)}`);
  }
  validateHTMLOptions(options);
  resolveDelimiter(options.delimiter);
  const { text, html } = resolveContents(source);

  let textRows: Grid | undefined;
  const fromText = (): ClipboardGrid => ({ rows: (textRows ??= parseTSV(text, options)), merges: [], source: 'text' });

  if (prefer === 'text' && text) return fromText();

  if (html) {
    const { table, hasOutsideText } = scanHTML(html, options);
    if (table && table.rows.length > 0) {
      if (prefer === 'html' || !text) return { rows: table.rows, merges: table.merges, source: 'html' };
      if (!hasOutsideText) {
        // A custom cell mapper asks for values from the HTML.
        if (options.cell) return { rows: table.rows, merges: table.merges, source: 'html' };
        textRows = parseTSV(text, options);
        if (sameShape(textRows, table.rows)) {
          if (options.mergedCells === 'repeat') repeatMerged(textRows, table.merges);
          return { rows: textRows, merges: table.merges, source: 'text' };
        }
        return { rows: table.rows, merges: table.merges, source: 'html' };
      }
    }
  }
  if (text) return fromText();
  return { rows: [], merges: [], source: 'none' };
}

function sameShape(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) if (a[r]!.length !== b[r]!.length) return false;
  return true;
}

function repeatMerged(rows: Grid, merges: MergeRange[]): void {
  for (const m of merges) {
    const value = rows[m.row]![m.col]!;
    for (let r = m.row; r < m.row + m.rowSpan; r++) {
      for (let c = m.col; c < m.col + m.colSpan; c++) rows[r]![c] = value;
    }
  }
}

/**
 * Serialises a grid into both clipboard flavours: tab-separated `text/plain`
 * for plain-text targets and an HTML table for spreadsheets and rich-text
 * editors.
 */
export function stringifyClipboard(grid: ReadonlyGrid, options: StringifyClipboardOptions = {}): ClipboardPayload {
  return { text: stringifyTSV(grid, options), html: stringifyHTMLTable(grid, options) };
}

interface WritableDataTransfer {
  setData(format: string, data: string): void;
}

/**
 * Writes a grid to the clipboard from inside a `copy` or `cut` event
 * handler (DOM or React) and cancels the event's default action.
 *
 * @example
 * element.addEventListener('copy', (event) => setClipboardData(event, selectedCells()));
 */
export function setClipboardData(
  target: { clipboardData: WritableDataTransfer | null; preventDefault?: () => void } | WritableDataTransfer,
  grid: ReadonlyGrid,
  options: StringifyClipboardOptions = {},
): ClipboardPayload {
  if (target === null || typeof target !== 'object') {
    throw new TypeError(`gridclip: setClipboardData expects a ClipboardEvent or DataTransfer, received ${describe(target)}`);
  }
  const isEvent = 'clipboardData' in target;
  const data = isEvent ? target.clipboardData : (target as WritableDataTransfer);
  if (!data || typeof data.setData !== 'function') {
    throw new TypeError('gridclip: the event has no clipboardData to write to');
  }
  const payload = stringifyClipboard(grid, options);
  data.setData('text/plain', payload.text);
  data.setData('text/html', payload.html);
  if (isEvent && typeof (target as { preventDefault?: () => void }).preventDefault === 'function') {
    (target as { preventDefault: () => void }).preventDefault();
  }
  return payload;
}

/** How {@link copyToClipboard} managed to write the clipboard. */
export type CopyMethod = 'clipboard-api' | 'exec-command' | 'write-text';

declare const ClipboardItem: { new (items: Record<string, Blob>): unknown } | undefined;

interface NavigatorClipboardLike {
  write?: (items: unknown[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  read?: () => Promise<Array<{ types: ReadonlyArray<string>; getType(type: string): Promise<Blob> }>>;
  readText?: () => Promise<string>;
}

function getClipboard(): NavigatorClipboardLike | undefined {
  const nav = (globalThis as { navigator?: { clipboard?: NavigatorClipboardLike } }).navigator;
  return nav?.clipboard;
}

/**
 * Copies a grid to the system clipboard with both a `text/plain` (TSV) and a
 * `text/html` (table) flavour. Call it from a user gesture such as a click
 * or key press.
 *
 * Tries, in order: the Async Clipboard API (`navigator.clipboard.write`),
 * `document.execCommand('copy')` (older browsers, non-secure contexts) and
 * finally `navigator.clipboard.writeText` (text only). Resolves with the
 * method that worked; rejects when none did.
 */
export async function copyToClipboard(grid: ReadonlyGrid, options: StringifyClipboardOptions = {}): Promise<CopyMethod> {
  const payload = stringifyClipboard(grid, options);
  const clipboard = getClipboard();
  let firstError: unknown;

  if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItem === 'function' && typeof Blob === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([payload.text], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ]);
      return 'clipboard-api';
    } catch (error) {
      firstError = error;
    }
  }

  if (execCommandCopy(payload)) return 'exec-command';

  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(payload.text);
      return 'write-text';
    } catch (error) {
      firstError ??= error;
    }
  }

  throw new Error('gridclip: unable to write to the clipboard' + (firstError ? '' : ' (no clipboard API available)'), {
    cause: firstError,
  });
}

function execCommandCopy(payload: ClipboardPayload): boolean {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.execCommand !== 'function' || !doc.body) return false;

  let written = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', payload.text);
    event.clipboardData.setData('text/html', payload.html);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };

  // Some browsers only fire `copy` when something is selected.
  const selection = doc.getSelection ? doc.getSelection() : null;
  const ranges: Range[] = [];
  if (selection) for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
  const active = doc.activeElement as HTMLElement | null;

  const textarea = doc.createElement('textarea');
  textarea.value = payload.text || ' ';
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
  doc.body.appendChild(textarea);
  doc.addEventListener('copy', onCopy, true);
  let ok = false;
  try {
    textarea.select();
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    doc.removeEventListener('copy', onCopy, true);
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (active && typeof active.focus === 'function' && active !== doc.body) active.focus({ preventScroll: true });
  }
  return ok && written;
}

/**
 * Reads the system clipboard and parses it like {@link parseClipboard}.
 * Uses `navigator.clipboard.read()` (both flavours), falling back to
 * `navigator.clipboard.readText()`. Browsers may ask the user for permission.
 */
export async function readFromClipboard(options: ParseClipboardOptions = {}): Promise<ClipboardGrid> {
  const clipboard = getClipboard();
  if (!clipboard || (typeof clipboard.read !== 'function' && typeof clipboard.readText !== 'function')) {
    throw new Error('gridclip: the Async Clipboard API is not available (it requires a secure context)');
  }
  let firstError: unknown;
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read();
      let text = '';
      let html = '';
      for (const item of items) {
        if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      return parseClipboard({ text, html }, options);
    } catch (error) {
      firstError = error;
    }
  }
  if (typeof clipboard.readText === 'function') {
    try {
      return parseClipboard({ text: await clipboard.readText() }, options);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw new Error('gridclip: unable to read the clipboard', { cause: firstError });
}
