/** Converts an arbitrary cell value into the string that should be written to the clipboard. */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

export function assertGrid(value: unknown, name: string): asserts value is ReadonlyArray<ReadonlyArray<unknown>> {
  if (!Array.isArray(value)) {
    throw new TypeError(`gridclip: ${name} must be an array of rows, received ${describe(value)}`);
  }
  for (let r = 0; r < value.length; r++) {
    if (!Array.isArray(value[r])) {
      throw new TypeError(`gridclip: ${name}[${r}] must be an array of cells, received ${describe(value[r])}`);
    }
  }
}

export function assertNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`gridclip: ${name} must be a non-negative integer, received ${describe(value)}`);
  }
}

export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value.length > 20 ? value.slice(0, 20) + '…' : value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return typeof value;
}

/** Number of columns of the widest row. */
export function gridWidth(grid: ReadonlyArray<ReadonlyArray<unknown>>): number {
  let width = 0;
  for (const row of grid) if (row.length > width) width = row.length;
  return width;
}
