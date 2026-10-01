import type { MergeRange, ReadonlyGrid } from '../types';
import { assertGrid, assertNonNegativeInteger, cellToString, describe, gridWidth } from '../util';

export interface StringifyHTMLTableOptions {
  /** Merged cells to emit as `rowspan`/`colspan`. Must lie inside the grid and must not overlap. */
  merges?: ReadonlyArray<MergeRange>;
  /** Number of leading rows rendered as `<th>` header cells. @default 0 */
  headerRows?: number;
}

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Line break that Excel keeps inside the cell instead of starting a new row. */
const BR = '<br style="mso-data-placement:same-cell">';

function cellHTML(value: string): { attrs: string; html: string } {
  // Whitespace that HTML would otherwise collapse: tabs, form feeds, runs of
  // spaces, and spaces at the start or end of a line.
  const needsPre = /[\t\f]| {2}|(?:^|[\r\n]) | (?:[\r\n]|$)/.test(value);
  let html = escapeText(value).replace(/\r\n|\r|\n/g, BR);
  // A final line break only shows (and survives parsing) when followed by another.
  if (/[\r\n]$/.test(value)) html += BR;
  return { attrs: needsPre ? ' style="white-space:pre-wrap"' : '', html };
}

/**
 * Serialises a grid to an HTML table suitable for the `text/html` clipboard
 * flavour. Spreadsheets and rich-text editors paste it as a table, keeping
 * merged cells, in-cell line breaks and significant whitespace. The markup is
 * prefixed with `<meta charset="utf-8">` so that Excel on Windows decodes
 * non-ASCII text (Korean, Japanese, emoji, …) correctly.
 */
export function stringifyHTMLTable(grid: ReadonlyGrid, options: StringifyHTMLTableOptions = {}): string {
  assertGrid(grid, 'grid');
  const headerRows = options.headerRows ?? 0;
  assertNonNegativeInteger(headerRows, 'headerRows');
  const height = grid.length;
  const width = gridWidth(grid);

  // 0 = free, 1 = covered by a merge, 2 = merge origin.
  const covered: Uint8Array[] = [];
  const origins = new Map<number, MergeRange>();
  const merges = options.merges ?? [];
  if (!Array.isArray(merges)) {
    throw new TypeError(`gridclip: merges must be an array, received ${describe(merges)}`);
  }
  for (let m = 0; m < merges.length; m++) {
    const merge = merges[m]!;
    if (merge === null || typeof merge !== 'object') {
      throw new TypeError(`gridclip: merges[${m}] must be an object, received ${describe(merge)}`);
    }
    const { row, col, rowSpan, colSpan } = merge;
    assertNonNegativeInteger(row, `merges[${m}].row`);
    assertNonNegativeInteger(col, `merges[${m}].col`);
    assertNonNegativeInteger(rowSpan, `merges[${m}].rowSpan`);
    assertNonNegativeInteger(colSpan, `merges[${m}].colSpan`);
    if (rowSpan < 1 || colSpan < 1) {
      throw new RangeError(`gridclip: merges[${m}] must span at least one row and one column`);
    }
    if (row + rowSpan > height || col + colSpan > width) {
      throw new RangeError(`gridclip: merges[${m}] extends outside the ${height}×${width} grid`);
    }
    for (let r = row; r < row + rowSpan; r++) {
      const line = (covered[r] ??= new Uint8Array(width));
      for (let c = col; c < col + colSpan; c++) {
        if (line[c] !== 0) throw new RangeError(`gridclip: merges[${m}] overlaps another merge`);
        line[c] = 1;
      }
    }
    covered[row]![col] = 2;
    origins.set(row * width + col, merge);
  }

  let out = '<meta charset="utf-8"><table><tbody>';
  for (let r = 0; r < height; r++) {
    const row = grid[r]!;
    const tag = r < headerRows ? 'th' : 'td';
    out += '<tr>';
    for (let c = 0; c < width; c++) {
      const state = covered[r]?.[c] ?? 0;
      if (state === 1) continue;
      let spans = '';
      if (state === 2) {
        const merge = origins.get(r * width + c)!;
        if (merge.rowSpan > 1) spans += ` rowspan="${merge.rowSpan}"`;
        if (merge.colSpan > 1) spans += ` colspan="${merge.colSpan}"`;
      }
      const { attrs, html } = cellHTML(cellToString(row[c]));
      out += `<${tag}${spans}${attrs}>${html}</${tag}>`;
    }
    out += '</tr>';
  }
  return out + '</tbody></table>';
}
