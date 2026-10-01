import type { CellRange, Grid, ReadonlyGrid } from './types';
import { assertGrid, assertNonNegativeInteger, gridWidth } from './util';

export interface ApplyPasteOptions<F = string> {
  /** Row of the top-left target cell. @default 0 */
  row?: number;
  /** Column of the top-left target cell. @default 0 */
  col?: number;
  /**
   * Height of the selected target range. When the selection's height and
   * width are both multiples of the pasted block's, the block is repeated to
   * fill the selection — the way Excel and Google Sheets behave.
   */
  rows?: number;
  /** Width of the selected target range, see {@link ApplyPasteOptions.rows}. */
  cols?: number;
  /**
   * Whether the grid may grow to fit the pasted block. `false` clips the
   * block at the grid's edges; `'rows'` / `'cols'` allow growth in one
   * direction only.
   * @default true
   */
  grow?: boolean | 'rows' | 'cols';
  /** Value for slots created by growing the grid or missing from ragged rows. @default '' */
  fill?: F;
}

export interface ApplyPasteResult<T> {
  /** A new grid; the input grid is never modified. */
  grid: Grid<T>;
  /** The block of cells that was written (empty when nothing was pasted). */
  range: CellRange;
}

/**
 * Pastes a block of cells into a grid at a given position and returns a new
 * grid. Implements spreadsheet semantics: tiling into a larger selection,
 * growing (or clipping at) the grid's edges.
 *
 * @example
 * applyPaste([['a', 'b'], ['c', 'd']], [['X']], { row: 0, col: 0, rows: 2, cols: 2 }).grid
 * // [['X', 'X'], ['X', 'X']]
 */
export function applyPaste<T, U, F = string>(
  grid: ReadonlyGrid<T>,
  data: ReadonlyGrid<U>,
  options: ApplyPasteOptions<F> = {},
): ApplyPasteResult<T | U | F> {
  assertGrid(grid, 'grid');
  assertGrid(data, 'data');
  const row = options.row ?? 0;
  const col = options.col ?? 0;
  assertNonNegativeInteger(row, 'row');
  assertNonNegativeInteger(col, 'col');
  if (options.rows !== undefined) assertNonNegativeInteger(options.rows, 'rows');
  if (options.cols !== undefined) assertNonNegativeInteger(options.cols, 'cols');
  const grow = options.grow ?? true;
  if (grow !== true && grow !== false && grow !== 'rows' && grow !== 'cols') {
    throw new TypeError(`gridclip: grow must be true, false, 'rows' or 'cols'`);
  }
  const fill = (options.fill === undefined ? '' : options.fill) as F;

  const dataRows = data.length;
  const dataCols = gridWidth(data);
  const gridRows = grid.length;
  const gridCols = gridWidth(grid);
  const result: Grid<T | U | F> = grid.map((r) => r.slice() as Array<T | U | F>);

  if (dataRows === 0 || dataCols === 0) {
    padRows(result, gridCols, fill);
    return { grid: result, range: { row, col, rows: 0, cols: 0 } };
  }

  const selRows = options.rows ?? 0;
  const selCols = options.cols ?? 0;
  const tile = selRows > 0 && selCols > 0 && selRows % dataRows === 0 && selCols % dataCols === 0;
  let rows = tile ? selRows : dataRows;
  let cols = tile ? selCols : dataCols;

  const growRows = grow === true || grow === 'rows';
  const growCols = grow === true || grow === 'cols';
  if (!growRows) rows = Math.max(0, Math.min(rows, gridRows - row));
  if (!growCols) cols = Math.max(0, Math.min(cols, gridCols - col));

  const width = Math.max(gridCols, rows > 0 && cols > 0 ? col + cols : 0);
  const height = Math.max(gridRows, rows > 0 && cols > 0 ? row + rows : 0);
  while (result.length < height) result.push([]);
  padRows(result, width, fill);

  for (let r = 0; r < rows; r++) {
    const source = data[r % dataRows]!;
    const target = result[row + r]!;
    for (let c = 0; c < cols; c++) {
      const k = c % dataCols;
      target[col + c] = k < source.length ? source[k]! : fill;
    }
  }
  return { grid: result, range: { row, col, rows: rows > 0 && cols > 0 ? rows : 0, cols: rows > 0 && cols > 0 ? cols : 0 } };
}

function padRows<V>(grid: Grid<V>, width: number, fill: V): void {
  for (const r of grid) while (r.length < width) r.push(fill);
}

/**
 * Copies a rectangular block out of a grid, e.g. the current selection
 * before handing it to {@link copyToClipboard}. Slots outside the grid are
 * filled with `fill`.
 *
 * @example
 * sliceGrid([['a', 'b'], ['c', 'd']], { row: 1, col: 0, rows: 1, cols: 2 }) // [['c', 'd']]
 */
export function sliceGrid<T, F = string>(grid: ReadonlyGrid<T>, range: CellRange, fill?: F): Grid<T | F> {
  assertGrid(grid, 'grid');
  if (range === null || typeof range !== 'object') throw new TypeError('gridclip: range must be an object');
  assertNonNegativeInteger(range.row, 'range.row');
  assertNonNegativeInteger(range.col, 'range.col');
  assertNonNegativeInteger(range.rows, 'range.rows');
  assertNonNegativeInteger(range.cols, 'range.cols');
  const pad = (fill === undefined ? '' : fill) as F;
  const out: Grid<T | F> = [];
  for (let r = 0; r < range.rows; r++) {
    const source = grid[range.row + r];
    const line: Array<T | F> = [];
    for (let c = 0; c < range.cols; c++) {
      const k = range.col + c;
      line.push(source !== undefined && k < source.length ? source[k]! : pad);
    }
    out.push(line);
  }
  return out;
}
