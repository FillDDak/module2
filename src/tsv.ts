import type { Grid, ReadonlyGrid } from './types';
import { assertGrid, cellToString, describe, gridWidth } from './util';

export interface ParseTSVOptions {
  /**
   * Field separator. A single character other than `"`, `\r` or `\n`.
   * Use `','` to parse CSV.
   * @default '\t'
   */
  delimiter?: string;
  /**
   * Pad short rows with `''` so every row has the same number of cells.
   * @default true
   */
  rectangular?: boolean;
  /**
   * Convert `\r\n` and lone `\r` *inside quoted cells* to `\n`, which is how
   * Excel and Google Sheets represent in-cell line breaks.
   * @default true
   */
  normalizeNewlines?: boolean;
}

export interface StringifyTSVOptions {
  /** Field separator, see {@link ParseTSVOptions.delimiter}. @default '\t' */
  delimiter?: string;
  /** Row separator. @default '\n' */
  lineEnding?: '\n' | '\r\n';
  /**
   * Terminate the last row with a line ending as well (Excel does this).
   * Note that a grid whose last row is a single empty cell always gets a
   * trailing line ending, otherwise that row could not be told apart from
   * "no row at all".
   * @default false
   */
  trailingNewline?: boolean;
}

/** @internal */
export function resolveDelimiter(delimiter: unknown): string {
  if (delimiter === undefined) return '\t';
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || delimiter === '"' || delimiter === '\r' || delimiter === '\n') {
    throw new TypeError(
      `gridclip: delimiter must be a single character other than '"', '\\r' or '\\n', received ${describe(delimiter)}`,
    );
  }
  return delimiter;
}

/**
 * Parses tab-separated text, as produced by Excel, Google Sheets,
 * LibreOffice and most data grids when cells are copied.
 *
 * - Cells that start with `"` and whose closing quote is followed by a
 *   delimiter, line break or the end of input are unquoted (`""` → `"`).
 *   Any other quote is kept literally, so prose such as `5" ruler` or
 *   `"Hi" she said` survives untouched.
 * - `\r\n`, `\n` and `\r` all end a row. A single trailing line ending is
 *   ignored, matching the way spreadsheets terminate the last row.
 * - A leading byte order mark is removed.
 *
 * @example
 * parseTSV('a\tb\n"multi\nline"\tc') // [['a', 'b'], ['multi\nline', 'c']]
 */
export function parseTSV(text: string, options: ParseTSVOptions = {}): Grid {
  if (typeof text !== 'string') {
    throw new TypeError(`gridclip: parseTSV expects a string, received ${describe(text)}`);
  }
  const delimiter = resolveDelimiter(options.delimiter);
  const rectangular = options.rectangular !== false;
  const normalizeNewlines = options.normalizeNewlines !== false;

  const rows: Grid = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  if (i >= n) return rows;

  // Position from which a search for '"' is already known to fail. Keeps
  // pathological input (many unterminated quotes) linear.
  let noQuoteFrom = n + 1;
  let row: string[] = [];

  for (;;) {
    let value: string | undefined;

    if (text.charCodeAt(i) === 34 /* " */) {
      // Try to read a quoted field.
      let j = i + 1;
      let close = -1;
      while (j < noQuoteFrom) {
        const k = text.indexOf('"', j);
        if (k === -1) {
          noQuoteFrom = j;
          break;
        }
        if (text.charCodeAt(k + 1) === 34) {
          j = k + 2;
          continue;
        }
        close = k;
        break;
      }
      if (close !== -1) {
        const after = close + 1;
        const c = text[after];
        if (after === n || c === delimiter || c === '\n' || c === '\r') {
          value = text.slice(i + 1, close).replace(/""/g, '"');
          if (normalizeNewlines && value.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
          i = after;
        }
      }
    }

    if (value === undefined) {
      // Literal field: everything up to the next delimiter or line break.
      let j = i;
      while (j < n) {
        const c = text[j];
        if (c === delimiter || c === '\n' || c === '\r') break;
        j++;
      }
      value = text.slice(i, j);
      i = j;
    }

    row.push(value);

    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === delimiter) {
      i++;
      if (i >= n) {
        row.push('');
        rows.push(row);
        break;
      }
      continue;
    }
    // Line break.
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }

  if (rectangular) padRows(rows);
  return rows;
}

function padRows(rows: Grid): void {
  const width = gridWidth(rows);
  for (const row of rows) while (row.length < width) row.push('');
}

/**
 * Serialises a grid to tab-separated text that Excel, Google Sheets and
 * LibreOffice paste back into the very same cells.
 *
 * A cell is quoted when it contains the delimiter or a line break, or when it
 * starts with `"` (or a byte order mark, which would otherwise be stripped). `null` and `undefined` become empty cells; other values go
 * through `String()` (dates become ISO 8601 strings).
 *
 * @example
 * stringifyTSV([['a', 'b'], ['multi\nline', 'c']]) // 'a\tb\n"multi\nline"\tc'
 */
export function stringifyTSV(grid: ReadonlyGrid, options: StringifyTSVOptions = {}): string {
  assertGrid(grid, 'grid');
  const delimiter = resolveDelimiter(options.delimiter);
  const lineEnding = options.lineEnding ?? '\n';
  if (lineEnding !== '\n' && lineEnding !== '\r\n') {
    throw new TypeError(`gridclip: lineEnding must be '\\n' or '\\r\\n', received ${describe(lineEnding)}`);
  }

  let out = '';
  for (let r = 0; r < grid.length; r++) {
    if (r > 0) out += lineEnding;
    const row = grid[r]!;
    for (let c = 0; c < row.length; c++) {
      if (c > 0) out += delimiter;
      out += quoteCell(cellToString(row[c]), delimiter);
    }
  }
  if (grid.length > 0) {
    const last = grid[grid.length - 1]!;
    const lastIsBlank = last.length === 0 || (last.length === 1 && cellToString(last[0]) === '');
    if (options.trailingNewline || lastIsBlank) out += lineEnding;
  }
  return out;
}

function quoteCell(value: string, delimiter: string): string {
  if (
    value.charCodeAt(0) === 34 ||
    value.charCodeAt(0) === 0xfeff ||
    value.indexOf(delimiter) !== -1 ||
    value.indexOf('\n') !== -1 ||
    value.indexOf('\r') !== -1
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
