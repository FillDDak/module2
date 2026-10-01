import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPaste, sliceGrid } from '../src';

const base = () => [
  ['a', 'b', 'c'],
  ['d', 'e', 'f'],
];

describe('applyPaste', () => {
  it('pastes at the origin by default', () => {
    expect(applyPaste(base(), [['X', 'Y']])).toEqual({
      grid: [
        ['X', 'Y', 'c'],
        ['d', 'e', 'f'],
      ],
      range: { row: 0, col: 0, rows: 1, cols: 2 },
    });
  });

  it('pastes at a position', () => {
    expect(applyPaste(base(), [['X']], { row: 1, col: 2 }).grid).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'X'],
    ]);
  });

  it('never mutates its inputs', () => {
    const grid = base();
    const data = [['X']];
    const frozen = Object.freeze(grid.map((r) => Object.freeze(r)));
    const result = applyPaste(frozen, data, { rows: 2, cols: 3 });
    expect(grid).toEqual(base());
    expect(result.grid).not.toBe(grid);
    expect(result.grid[0]).not.toBe(grid[0]);
  });

  it('grows the grid to fit', () => {
    expect(applyPaste(base(), [['1', '2'], ['3', '4']], { row: 1, col: 2 })).toEqual({
      grid: [
        ['a', 'b', 'c', ''],
        ['d', 'e', '1', '2'],
        ['', '', '3', '4'],
      ],
      range: { row: 1, col: 2, rows: 2, cols: 2 },
    });
  });

  it('pastes past the end with gaps', () => {
    expect(applyPaste([['a']], [['X']], { row: 2, col: 2 }).grid).toEqual([
      ['a', '', ''],
      ['', '', ''],
      ['', '', 'X'],
    ]);
  });

  it('clips with grow: false', () => {
    expect(applyPaste(base(), [['1', '2'], ['3', '4']], { row: 1, col: 2, grow: false })).toEqual({
      grid: [
        ['a', 'b', 'c'],
        ['d', 'e', '1'],
      ],
      range: { row: 1, col: 2, rows: 1, cols: 1 },
    });
  });

  it('writes nothing when the target is outside a fixed grid', () => {
    expect(applyPaste(base(), [['X']], { row: 5, col: 0, grow: false })).toEqual({ grid: base(), range: { row: 5, col: 0, rows: 0, cols: 0 } });
    expect(applyPaste(base(), [['X']], { row: 0, col: 9, grow: false })).toEqual({ grid: base(), range: { row: 0, col: 9, rows: 0, cols: 0 } });
  });

  it("grows in one direction with grow: 'rows' / 'cols'", () => {
    const data = [['1', '2'], ['3', '4']];
    expect(applyPaste(base(), data, { row: 1, col: 2, grow: 'rows' }).grid).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', '1'],
      ['', '', '3'],
    ]);
    expect(applyPaste(base(), data, { row: 1, col: 2, grow: 'cols' }).grid).toEqual([
      ['a', 'b', 'c', ''],
      ['d', 'e', '1', '2'],
    ]);
  });

  it('tiles a block into a selection that is a multiple of its size', () => {
    expect(applyPaste([[]], [['X']], { rows: 2, cols: 3 }).grid).toEqual([
      ['X', 'X', 'X'],
      ['X', 'X', 'X'],
    ]);
    expect(applyPaste([[]], [['1', '2']], { rows: 3, cols: 4 }).grid).toEqual([
      ['1', '2', '1', '2'],
      ['1', '2', '1', '2'],
      ['1', '2', '1', '2'],
    ]);
    expect(applyPaste([[]], [['1'], ['2']], { rows: 4, cols: 1 }).grid).toEqual([['1'], ['2'], ['1'], ['2']]);
  });

  it('pastes once when the selection is not a multiple', () => {
    expect(applyPaste(base(), [['1', '2']], { rows: 2, cols: 3 })).toEqual({
      grid: [
        ['1', '2', 'c'],
        ['d', 'e', 'f'],
      ],
      range: { row: 0, col: 0, rows: 1, cols: 2 },
    });
    // A single selected cell never limits the paste.
    expect(applyPaste(base(), [['1', '2'], ['3', '4']], { rows: 1, cols: 1 }).range).toEqual({ row: 0, col: 0, rows: 2, cols: 2 });
  });

  it('clips a tiled selection at the edge of a fixed grid', () => {
    expect(applyPaste(base(), [['X']], { row: 1, col: 1, rows: 5, cols: 5, grow: false })).toEqual({
      grid: [
        ['a', 'b', 'c'],
        ['d', 'X', 'X'],
      ],
      range: { row: 1, col: 1, rows: 1, cols: 2 },
    });
  });

  it('fills ragged data and new slots with the fill value', () => {
    expect(applyPaste([[1]], [['a', 'b'], ['c']], { row: 0, col: 1, fill: null }).grid).toEqual([
      [1, 'a', 'b'],
      [null, 'c', null],
    ]);
  });

  it('pads a ragged target grid', () => {
    expect(applyPaste([['a', 'b', 'c'], ['d']], [['X']], { row: 1, col: 1 }).grid).toEqual([
      ['a', 'b', 'c'],
      ['d', 'X', ''],
    ]);
  });

  it('accepts non-string cells', () => {
    const result = applyPaste([[1, 2]], [[true]], { col: 1 });
    expect(result.grid).toEqual([[1, true]]);
  });

  it('does nothing for empty data', () => {
    expect(applyPaste(base(), [])).toEqual({ grid: base(), range: { row: 0, col: 0, rows: 0, cols: 0 } });
    expect(applyPaste(base(), [[]], { row: 1, col: 1 })).toEqual({ grid: base(), range: { row: 1, col: 1, rows: 0, cols: 0 } });
  });

  it('pastes into an empty grid', () => {
    expect(applyPaste([], [['a', 'b']]).grid).toEqual([['a', 'b']]);
  });

  it('validates arguments', () => {
    expect(() => applyPaste('x' as never, [])).toThrow(TypeError);
    expect(() => applyPaste([], 'x' as never)).toThrow(TypeError);
    expect(() => applyPaste([], [], { row: -1 })).toThrow(RangeError);
    expect(() => applyPaste([], [], { col: 1.5 })).toThrow(RangeError);
    expect(() => applyPaste([], [], { rows: NaN })).toThrow(RangeError);
    expect(() => applyPaste([], [], { cols: Infinity })).toThrow(RangeError);
    expect(() => applyPaste([], [], { grow: 'yes' as never })).toThrow(TypeError);
  });

  it('matches a reference implementation (property based)', () => {
    const smallGrid = fc.array(fc.array(fc.integer({ min: 0, max: 99 }), { maxLength: 4 }), { maxLength: 4 });
    fc.assert(
      fc.property(
        smallGrid,
        smallGrid,
        fc.nat(5),
        fc.nat(5),
        fc.option(fc.nat(6), { nil: undefined }),
        fc.option(fc.nat(6), { nil: undefined }),
        fc.constantFrom<Array<boolean | 'rows' | 'cols'>>(true, false, 'rows', 'cols'),
        (grid, data, row, col, rows, cols, grow) => {
          const { grid: out, range } = applyPaste(grid, data, { row, col, rows, cols, grow, fill: -1 });
          const dataRows = data.length;
          const dataCols = Math.max(0, ...data.map((r) => r.length));
          // Rectangular output, never smaller than the input.
          const width = out[0]?.length ?? 0;
          for (const r of out) expect(r).toHaveLength(width);
          expect(out.length).toBeGreaterThanOrEqual(grid.length);
          // Every cell inside the written range comes from the (tiled) data …
          for (let r = 0; r < range.rows; r++) {
            for (let c = 0; c < range.cols; c++) {
              const src = data[r % dataRows]![c % dataCols];
              expect(out[row + r]![col + c]).toBe(src === undefined ? -1 : src);
            }
          }
          // … and every cell outside it is untouched or fill.
          for (let r = 0; r < out.length; r++) {
            for (let c = 0; c < width; c++) {
              const inside = r >= row && r < row + range.rows && c >= col && c < col + range.cols;
              if (!inside) expect(out[r]![c]).toBe(grid[r]?.[c] ?? -1);
            }
          }
          if (dataRows > 0 && dataCols > 0 && range.rows > 0) {
            const tiled = (rows ?? 0) > 0 && (cols ?? 0) > 0 && rows! % dataRows === 0 && cols! % dataCols === 0;
            if (grow === true) expect([range.rows, range.cols]).toEqual(tiled ? [rows, cols] : [dataRows, dataCols]);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });
});

describe('sliceGrid', () => {
  it('copies a block', () => {
    expect(sliceGrid(base(), { row: 0, col: 1, rows: 2, cols: 2 })).toEqual([
      ['b', 'c'],
      ['e', 'f'],
    ]);
  });

  it('fills outside the grid', () => {
    expect(sliceGrid(base(), { row: 1, col: 2, rows: 2, cols: 2 })).toEqual([
      ['f', ''],
      ['', ''],
    ]);
    expect(sliceGrid([[1]], { row: 0, col: 0, rows: 1, cols: 2 }, 0)).toEqual([[1, 0]]);
  });

  it('returns copies', () => {
    const grid = base();
    const out = sliceGrid(grid, { row: 0, col: 0, rows: 2, cols: 3 });
    expect(out).toEqual(grid);
    expect(out[0]).not.toBe(grid[0]);
  });

  it('handles empty ranges', () => {
    expect(sliceGrid(base(), { row: 0, col: 0, rows: 0, cols: 5 })).toEqual([]);
    expect(sliceGrid(base(), { row: 0, col: 0, rows: 2, cols: 0 })).toEqual([[], []]);
  });

  it('validates arguments', () => {
    expect(() => sliceGrid(base(), null as never)).toThrow(TypeError);
    expect(() => sliceGrid(base(), { row: -1, col: 0, rows: 1, cols: 1 })).toThrow(RangeError);
    expect(() => sliceGrid(base(), { row: 0, col: 0, rows: 1 } as never)).toThrow(RangeError);
  });

  it('round-trips with applyPaste', () => {
    const grid = base();
    const block = sliceGrid(grid, { row: 0, col: 0, rows: 2, cols: 2 });
    expect(applyPaste(grid, block, { row: 0, col: 1, grow: false }).grid).toEqual([
      ['a', 'a', 'b'],
      ['d', 'd', 'e'],
    ]);
  });
});
