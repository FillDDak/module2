// Runtime-agnostic assertions shared by the ESM and CommonJS smoke tests.
'use strict';

module.exports = function run(g, label) {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`[${label}] ${msg}`);
  };
  const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  const grid = [['이름', 'multi\nline', '"q"'], ['😀', '', 'a\tb']];
  eq(g.parseTSV(g.stringifyTSV(grid)), grid, 'TSV round-trip');
  eq(g.parseTSV('a,"b,c"', { delimiter: ',' }), [['a', 'b,c']], 'CSV');
  const merges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }];
  eq(g.parseHTMLTable(g.stringifyHTMLTable(grid, { merges })), { rows: [['이름', '', '"q"'], grid[1]], merges }, 'HTML round-trip');
  const payload = g.stringifyClipboard(grid, { merges });
  eq(g.parseClipboard(payload), { rows: grid, merges, source: 'text' }, 'clipboard round-trip');
  eq(g.applyPaste([['a']], [['X']], { rows: 2, cols: 2 }).grid, [['X', 'X'], ['X', 'X']], 'applyPaste');
  eq(g.sliceGrid([['a', 'b']], { row: 0, col: 1, rows: 1, cols: 1 }), [['b']], 'sliceGrid');
  let threw = false;
  try {
    g.parseTSV(1);
  } catch (e) {
    threw = e instanceof TypeError;
  }
  assert(threw, 'TypeError on bad input');
  // Browser-only functions must fail gracefully where there is no clipboard.
  return Promise.all([
    g.copyToClipboard([['x']]).then(
      () => 'resolved',
      (e) => e.message,
    ),
    g.readFromClipboard().then(
      () => 'resolved',
      (e) => e.message,
    ),
  ]).then(([copy, read]) => {
    assert(/clipboard/.test(copy), 'copyToClipboard rejects without a clipboard: ' + copy);
    assert(/clipboard/i.test(read), 'readFromClipboard rejects without a clipboard: ' + read);
    console.log(`ok ${label}`);
  });
};
