// Compiled (not run) against the published type declarations.
import {
  applyPaste,
  copyToClipboard,
  parseClipboard,
  parseHTMLTable,
  parseTSV,
  readFromClipboard,
  setClipboardData,
  sliceGrid,
  stringifyClipboard,
  stringifyHTMLTable,
  stringifyTSV,
  type ClipboardGrid,
  type CopyMethod,
  type Grid,
  type HTMLTable,
  type MergeRange,
} from 'gridclip';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_: T) => {};

const grid: Grid = parseTSV('a\tb');
assertType<Equal<typeof grid, string[][]>>(true);

const table = parseHTMLTable('<table>');
assertType<Equal<typeof table, HTMLTable | null>>(true);
if (table) {
  const merges: MergeRange[] = table.merges;
  void merges;
}

// Readonly and mixed-type grids are accepted for serialisation.
const readonlyGrid = [['a', 1, null, undefined, true, new Date()]] as const;
stringifyTSV(readonlyGrid);
stringifyHTMLTable(readonlyGrid, { merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }], headerRows: 1 });
stringifyClipboard(readonlyGrid, { lineEnding: '\r\n' });

// Clipboard sources: DOM events, React-like events, DataTransfer, strings.
declare const domEvent: ClipboardEvent;
declare const dragEvent: DragEvent;
declare const reactEvent: { clipboardData: DataTransfer; preventDefault(): void; nativeEvent: Event };
const fromDom: ClipboardGrid = parseClipboard(domEvent);
parseClipboard(dragEvent);
parseClipboard(reactEvent, { prefer: 'html', mergedCells: 'repeat', delimiter: ',' });
parseClipboard(new DataTransfer());
parseClipboard({ text: 'a', html: null });
assertType<Equal<typeof fromDom.source, 'html' | 'text' | 'none'>>(true);
setClipboardData(domEvent, grid);
setClipboardData(reactEvent, grid, { merges: [] });

// The cell hook gets typed cell information.
parseHTMLTable('<table>', {
  cell: ({ text, tag, attributes, row, col, rowSpan, colSpan }) => {
    assertType<Equal<typeof tag, 'td' | 'th'>>(true);
    const n: number = row + col + rowSpan + colSpan;
    return attributes['x:num'] ?? (n ? text : undefined);
  },
});

// applyPaste infers the union of cell types.
const pasted = applyPaste([[1, 2]], [['x']], { row: 0, col: 1, fill: null });
assertType<Equal<typeof pasted.grid, (number | string | null)[][]>>(true);
const sliced = sliceGrid([[1]], { row: 0, col: 0, rows: 1, cols: 2 }, 0);
assertType<Equal<typeof sliced, number[][]>>(true);

async function asyncApis() {
  const method: CopyMethod = await copyToClipboard(grid);
  const read: ClipboardGrid = await readFromClipboard({ prefer: 'text' });
  return [method, read] as const;
}
void asyncApis;

// @ts-expect-error -- invalid option values are rejected at compile time
parseClipboard(domEvent, { prefer: 'xml' });
// @ts-expect-error -- grids must be two-dimensional
stringifyTSV(['a', 'b']);
