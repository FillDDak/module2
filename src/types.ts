/** A rectangular (or ragged) two-dimensional array of cell values, row-major. */
export type Grid<T = string> = T[][];

/** A read-only view of a grid. Every function in this package accepts this. */
export type ReadonlyGrid<T = unknown> = ReadonlyArray<ReadonlyArray<T>>;

/** A merged (spanning) block of cells, in zero-based grid coordinates. */
export interface MergeRange {
  /** Zero-based row index of the top-left cell. */
  row: number;
  /** Zero-based column index of the top-left cell. */
  col: number;
  /** Number of rows covered (always >= 1). */
  rowSpan: number;
  /** Number of columns covered (always >= 1). */
  colSpan: number;
}

/** A rectangular block of cells, in zero-based grid coordinates. */
export interface CellRange {
  row: number;
  col: number;
  rows: number;
  cols: number;
}
