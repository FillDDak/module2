import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseHTMLTable, stringifyHTMLTable } from '../src';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const rows = (html: string, options?: Parameters<typeof parseHTMLTable>[1]) => parseHTMLTable(html, options)?.rows;
const cell = (inner: string) => rows(`<table><tr><td>${inner}</td></tr></table>`)![0]![0];

describe('parseHTMLTable: finding the table', () => {
  it.each(['', 'plain text', '<p>no table</p>', '<td>a</td>', '<!-- <table><tr><td>x</td></tr></table> -->', '<script><table><tr><td>x</script>'])(
    'returns null without a table: %j',
    (html) => {
      expect(parseHTMLTable(html)).toBeNull();
    },
  );

  it('returns an empty grid for an empty table', () => {
    expect(parseHTMLTable('<table></table>')).toEqual({ rows: [], merges: [] });
    expect(parseHTMLTable('<table>')).toEqual({ rows: [], merges: [] });
  });

  it('only reads the first table', () => {
    expect(rows('<table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>')).toEqual([['1']]);
  });

  it('ignores tables in invisible content', () => {
    expect(rows('<template><table><tr><td>t</td></tr></table></template><table><tr><td>real</td></tr></table>')).toEqual([['real']]);
    expect(rows('<div style="display:none"><table><tr><td>t</td></tr></table></div><table><tr><td>real</td></tr></table>')).toEqual([['real']]);
  });

  it('a <table> start tag directly inside a table ends it', () => {
    expect(rows('<table><tr><td>1</td></tr><table><tr><td>2</td></tr></table>')).toEqual([['1']]);
  });
});

describe('parseHTMLTable: structure', () => {
  it('reads rows and cells', () => {
    expect(rows('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('accepts implied end tags, implied <tr> and <tbody>, and a missing </table>', () => {
    expect(rows('<table><td>a<td>b<tr><td>c')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
  });

  it('is case-insensitive and supports every attribute syntax', () => {
    expect(parseHTMLTable(`<TABLE><TR><TD COLSPAN=2>a</TD><Td RowSpan='2'>b</tD></TR><tr><TH colspan = "2" >c</TH></TABLE>`)).toEqual({
      rows: [
        ['a', '', 'b'],
        ['c', '', ''],
      ],
      merges: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
        { row: 0, col: 2, rowSpan: 2, colSpan: 1 },
        { row: 1, col: 0, rowSpan: 1, colSpan: 2 },
      ],
    });
  });

  it('pads short rows', () => {
    expect(rows('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr><tr></tr></table>')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
      ['', '', ''],
    ]);
  });

  it('places cells around row spans', () => {
    const html = `<table>
      <tr><td rowspan=3>A</td><td>B</td><td rowspan=2>C</td></tr>
      <tr><td>D</td></tr>
      <tr><td>E</td><td>F</td></tr>
    </table>`;
    expect(parseHTMLTable(html)).toEqual({
      rows: [
        ['A', 'B', 'C'],
        ['', 'D', ''],
        ['', 'E', 'F'],
      ],
      merges: [
        { row: 0, col: 0, rowSpan: 3, colSpan: 1 },
        { row: 0, col: 2, rowSpan: 2, colSpan: 1 },
      ],
    });
  });

  it('lets later cells extend past a row span', () => {
    expect(rows('<table><tr><td>a</td><td rowspan=2>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>')).toEqual([
      ['a', 'b', '', ''],
      ['c', '', 'd', 'e'],
    ]);
  });

  it('supports rowspan="0" (span to the end of the row group)', () => {
    const html = '<table><tbody><tr><td rowspan=0>a</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></tbody><tbody><tr><td>x</td></tr></tbody></table>';
    expect(parseHTMLTable(html)).toEqual({
      rows: [['a', '1'], ['', '2'], ['', '3'], ['x', '']],
      merges: [{ row: 0, col: 0, rowSpan: 3, colSpan: 1 }],
    });
  });

  it('clips row spans at the end of their row group', () => {
    const html = '<table><thead><tr><th rowspan=5>h</th><th>x</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect(parseHTMLTable(html)).toEqual({ rows: [['h', 'x'], ['a', 'b']], merges: [] });
    expect(parseHTMLTable('<table><tr><td rowspan=3>a</td></tr></table>')).toEqual({ rows: [['a']], merges: [] });
  });

  it('treats row groups without explicit sections consistently', () => {
    const html = '<table><tr><td rowspan=2>a</td><td>b</td></tr><tbody><tr><td>c</td></tr></tbody></table>';
    expect(rows(html)).toEqual([['a', 'b'], ['c', '']]);
  });

  it.each<[string, number]>([
    ['2', 2],
    [' 2', 2],
    ['2px', 2],
    ['+2', 2],
    ['0', 1],
    ['-1', 1],
    ['abc', 1],
    ['', 1],
    ['1.9', 1],
    ['5000', 1000],
  ])('parses colspan=%j as %i', (value, expected) => {
    const table = parseHTMLTable(`<table><tr><td colspan="${value}">a</td><td>b</td></tr></table>`)!;
    expect(table.rows[0]).toHaveLength(expected + 1);
    expect(table.rows[0]![expected]).toBe('b');
  });

  it.each<[string, number]>([
    ['3', 3],
    ['abc', 1],
    ['-2', 1],
    ['0', 4],
    ['99999', 4],
  ])('parses rowspan=%j as %i (4 rows available)', (value, expected) => {
    const table = parseHTMLTable(`<table><tr><td rowspan="${value}">a</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr><tr><td>4</td></tr></table>`)!;
    expect(table.merges).toEqual(expected > 1 ? [{ row: 0, col: 0, rowSpan: expected, colSpan: 1 }] : []);
  });

  it('can repeat merged values', () => {
    expect(rows('<table><tr><td colspan=2 rowspan=2>m</td><td>a</td></tr><tr><td>b</td></tr></table>', { mergedCells: 'repeat' })).toEqual([
      ['m', 'm', 'a'],
      ['m', 'm', 'b'],
    ]);
  });

  it("treats Excel's mso-ignore:colspan as overflow, not as a merge", () => {
    const table = parseHTMLTable(`<table><tr><td colspan=3 style='mso-ignore:colspan'>long</td><td>x</td></tr></table>`, { mergedCells: 'repeat' });
    expect(table).toEqual({ rows: [['long', '', '', 'x']], merges: [] });
  });

  it('ignores captions, col and colgroup', () => {
    expect(rows('<table><caption>Title <b>bold</b></caption><colgroup><col><col span=2></colgroup><col><tr><td>a</td></tr></table>')).toEqual([['a']]);
  });

  it('flattens nested tables into their cell', () => {
    const html = '<table><tr><td>before<table><tr><td>n1</td><td>n2</td></tr><tr><td>n3</td></tr></table>after</td><td>x</td></tr></table>';
    expect(rows(html)).toEqual([['before\nn1 n2\nn3\nafter', 'x']]);
  });

  it('flattens nested tables with sections, captions and columns', () => {
    const html = '<table><tr><td><table><caption>c</caption><colgroup><col></colgroup><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table></td></tr></table>';
    expect(rows(html)).toEqual([['h\nb']]);
  });

  it('starts a sibling when a nested table is followed by another <table>', () => {
    const html = '<table><tr><td><table><tr><td>a</td></tr><table><tr><td>b</td></tr></table>c</td><td>d</td></tr></table>';
    expect(rows(html)).toEqual([['a\nb\nc', 'd']]);
  });

  it('ignores tables inside captions, however they nest', () => {
    const html = '<table><caption><table><tr><td><table></table></td></tr><table><tr><td>x</td></tr></table>cap</caption><tr><td>real</td></tr></table>';
    expect(rows(html)).toEqual([['real']]);
  });

  it('does not flatten hidden nested tables', () => {
    expect(rows('<table><tr><td>a<div hidden><table><tr><td>b</td></tr></table></div>c</td></tr></table>')).toEqual([['ac']]);
  });

  it('closes nested tables left open at the end of input', () => {
    expect(rows('<table><tr><td>a<table><tr><td>b<table><tr><td>c')).toEqual([['a\nb\nc']]);
  });

  it('stays linear on extremely deep nesting', () => {
    const depth = 20000;
    const html = '<table><tr><td>'.repeat(depth) + 'x'.repeat(100000) + '</td></tr></table>'.repeat(depth);
    const start = performance.now();
    const table = parseHTMLTable(html)!;
    expect(performance.now() - start).toBeLessThan(2000);
    expect(table.rows).toHaveLength(1);
    expect(parseHTMLTable('<table><tr><td>'.repeat(10) + 'deep')!.rows).toEqual([['deep']]);
  });

  it('ignores </body> and </html> inside a table', () => {
    expect(rows('<table><tr><td>a</body></html>b</td><td>c</td></tr></table>')).toEqual([['ab', 'c']]);
  });

  it('treats everything after <plaintext> as text', () => {
    expect(rows('<table><tr><td>a<plaintext>b</td><td>c')).toEqual([['a\nb</td><td>c']]);
  });

  it('handles deeply nested tables', () => {
    const html = '<table><tr><td>' + '<table><tr><td>'.repeat(50) + 'deep' + '</td></tr></table>'.repeat(50) + '</td><td>x</td></tr></table>';
    expect(rows(html)).toEqual([['deep', 'x']]);
  });

  it('ignores foster-parented content between rows', () => {
    expect(rows('<table>junk<tr>junk<td>a</td>junk</tr><div>junk</div></table>')).toEqual([['a']]);
  });

  it('ignores stray end tags', () => {
    expect(rows('<table></td></tr></tbody><tr><td>a</p></span></td></tr></table>')).toEqual([['a']]);
  });

  it('guards against paste bombs', () => {
    const bomb = '<table>' + '<tr><td colspan=1000></td><td colspan=1000></td>'.repeat(3000) + '</table>';
    expect(() => parseHTMLTable(bomb)).toThrow(RangeError);
    expect(() => parseHTMLTable(bomb, { maxCells: 1000 })).toThrow(/more than 1000 cells/);
    expect(parseHTMLTable('<table><tr><td>a<td>b</table>', { maxCells: 2 })?.rows).toEqual([['a', 'b']]);
    expect(() => parseHTMLTable('<table><tr><td>a<td>b<td>c</table>', { maxCells: 2 })).toThrow(RangeError);
  });

  it('validates options', () => {
    expect(() => parseHTMLTable('<table>', { mergedCells: 'x' as 'empty' })).toThrow(TypeError);
    expect(() => parseHTMLTable('<table>', { cell: 'x' as never })).toThrow(TypeError);
    expect(() => parseHTMLTable('<table>', { maxCells: -1 })).toThrow(TypeError);
    expect(() => parseHTMLTable('<table>', { maxCells: NaN })).toThrow(TypeError);
    expect(() => parseHTMLTable(null as unknown as string)).toThrow(TypeError);
    expect(() => parseHTMLTable('<table>', null as never)).toThrow(/options must be an object/);
  });
});

describe('parseHTMLTable: cell text', () => {
  it.each<[string, string]>([
    ['plain', 'plain'],
    ['  padded  ', 'padded'],
    ['a \n\t  b', 'a b'],
    ['<b>bold</b> <i>it</i>alic', 'bold italic'],
    ['a<b> </b>b', 'a b'],
    ['a <b> b</b>', 'a b'],
    ['line1<br>line2', 'line1\nline2'],
    ['line1<br/>line2', 'line1\nline2'],
    ['line1</br>line2', 'line1\nline2'],
    ["a<br style='mso-data-placement:same-cell'>b", 'a\nb'],
    ['a <br> b', 'a\nb'],
    ['a<br><br>b', 'a\n\nb'],
    ['a<br>', 'a'],
    ['a<br><br>', 'a\n'],
    ['<br>', ''],
    ['<br><br>', '\n'],
    ['<p>one</p><p>two</p>', 'one\ntwo'],
    ['<div>one</div><div></div><div>two</div>', 'one\ntwo'],
    ['<div><div>nested</div></div>', 'nested'],
    ['before<div>block</div>after', 'before\nblock\nafter'],
    ['<ul><li>a</li><li>b</li></ul>', 'a\nb'],
    ['a<hr>b', 'a\nb'],
    ['<p>a</p><br><p>b</p>', 'a\n\nb'],
    ['a<br><div>b</div>', 'a\nb'],
    ['<pre>  keep\n  this  </pre>', '  keep\n  this  '],
    ['<pre>\nfirst newline dropped</pre>', 'first newline dropped'],
    ['<pre>\r\nfirst CRLF dropped</pre>', 'first CRLF dropped'],
    ['<pre><b>\nnot dropped after a tag</b></pre>', '\nnot dropped after a tag'],
    ['<span style="white-space: pre-wrap">  a\tb  </span>', '  a\tb  '],
    ['<span style="white-space:pre-line">  a   b  \n  c </span>', 'a b\nc'],
    ['<span style="WHITE-SPACE: PRE !important">  x</span>', '  x'],
    ['<span style="color:red; white-space: /* c */ pre">  x</span>', '  x'],
    ["a<span style='mso-spacerun:yes'>&nbsp;&nbsp; </span>b", 'a   b'],
    ["<span style='mso-spacerun:yes'>  </span>lead", '  lead'],
    ['<pre>a<span style="white-space:normal">  b  </span>c</pre>', 'a b c'],
    ['visible<span style="display:none">hidden</span>', 'visible'],
    ['visible<span style="display: none !important">hidden</span>', 'visible'],
    ['visible<span hidden>hidden</span>', 'visible'],
    ['visible<div style="display:none"><p>a</p><p>b</p></div>!', 'visible!'],
    ['a<script>var x = "</td>";</script>b', 'ab'],
    ['a<style>td { color: red }</style>b', 'ab'],
    ['a<template><b>t</b></template>b', 'ab'],
    ['a<textarea>t</textarea>b', 'ab'],
    ['a<!-- comment -->b', 'ab'],
    ['a<!---->b<!-->c<!--->d', 'abcd'],
    ['a<![CDATA[x]]>b', 'ab'],
    ['a<![CDATA[x>y]]>b', 'ay]]>b'],
    ['visible<p hidden>a</p><p>b</p>', 'visible\nb'],
    ['a<?php echo 1 ?>b', 'ab'],
    ['<![if !supportLists]>1.<![endif]>item', '1.item'],
    ['<![if supportFields]>field code<![endif]>value', 'value'],
    ['a<img src="x.png" alt="img">b', 'ab'],
    ['a<wbr>b', 'ab'],
    ['&lt;tag&gt; &amp; &quot;q&quot; &#39;s&#39;', '<tag> & "q" \'s\''],
    ['&nbsp;', ''],
    ['&nbsp;&nbsp;', ''],
    ['a&nbsp;b', 'a b'],
    ['&nbsp;a', ' a'],
    ['a<br>&nbsp;<br>b', 'a\n\nb'],
    ['&#x1F600;&#128512;', '😀😀'],
    ['&#0;&#xD800;&#x110000;', '\ufffd\ufffd\ufffd'],
    ['&#128;&#x9F;', '€Ÿ'],
    ['&copy &copy; &COPY;', '© © ©'],
    ['&notit; &notin;', '¬it; ∉'],
    ['&unknown; & &; &#; &#x;', '&unknown; & &; &#; &#x;'],
    ['&ampx', '&x'],
    ['&constructor; &toString; &hasOwnProperty &valueOf;', '&constructor; &toString; &hasOwnProperty &valueOf;'],
    ['a < b', 'a < b'],
    ['a <3 b', 'a <3 b'],
    ['1 </ 2', '1'],
    ['한국어 <b>텍스트</b>', '한국어 텍스트'],
    // CSS edge cases, each verified against Chromium's innerText:
    ['a <span style="white-space:pre"><br></span>b', 'a \nb'],
    ['a <span style="white-space:pre-line"><br></span>b', 'a\nb'],
    ['<span style="white-space:pre-wrap">a </span>\nb', 'a  b'],
    ['<span style="white-space:pre-wrap">a<br>  </span>\nb', 'a\n  b'],
    ['<span style="white-space:pre-wrap">a<br>\t</span>\nb', 'a\n\t b'],
    ['<span style="white-space:pre">a<br> </span>\nb', 'a\n  b'],
    ['<span style="white-space:break-spaces"> </span>\nb', ' b'],
    ['a\u200b\nb', 'a\u200bb'],
    ['a\n\u200bb', 'a\u200bb'],
    ['a\u200b b', 'a\u200b b'],
  ])('%j → %j', (inner, expected) => {
    expect(cell(inner)).toBe(expected);
  });

  it('can keep no-break spaces', () => {
    expect(rows('<table><tr><td>a&nbsp;b</td><td>&nbsp;</td></tr></table>', { preserveNbsp: true })).toEqual([['a\u00a0b', '\u00a0']]);
  });

  it('honours white-space on the cell itself', () => {
    expect(cell('x') && rows('<table><tr><td style="white-space:pre-wrap">  a  </td></tr></table>')).toEqual([['  a  ']]);
  });

  it('decodes attribute values with the attribute rules', () => {
    const seen: Record<string, string>[] = [];
    parseHTMLTable(`<table><tr><td data-a="&amp;&lt;" data-b='&copy=1' data-c=&copy; data-d="&notit;" data-e>x</td></tr></table>`, {
      cell: (c) => void seen.push({ ...c.attributes }),
    });
    expect(seen[0]).toEqual({ 'data-a': '&<', 'data-b': '&copy=1', 'data-c': '©', 'data-d': '&notit;', 'data-e': '' });
  });

  it('treats attribute names like __proto__ as plain data', () => {
    let attributes: Readonly<Record<string, string>> = {};
    parseHTMLTable('<table><tr><td __proto__="x" constructor="y" tostring=z>a</td></tr></table>', { cell: (c) => void (attributes = c.attributes) });
    expect(Object.keys(attributes)).toEqual(['__proto__', 'constructor', 'tostring']);
    expect(attributes['__proto__']).toBe('x');
    expect(Object.getPrototypeOf(attributes)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('keeps the first of duplicate attributes', () => {
    expect(rows('<table><tr><td colspan=2 colspan=3>a</td></tr></table>')![0]).toHaveLength(2);
  });

  it('handles > inside quoted attribute values', () => {
    expect(rows('<table><tr><td title="a > b">x</td><td title=\'<td>\'>y</td></tr></table>')).toEqual([['x', 'y']]);
  });

  it('drops a tag cut off by the end of input', () => {
    expect(rows('<table><tr><td>a</td><td title="unterminated')).toEqual([['a']]);
  });
});

describe('parseHTMLTable: the cell option', () => {
  it('receives position, spans, tag and attributes', () => {
    const calls: unknown[] = [];
    parseHTMLTable('<table><tr><th colspan=2 class=h>H</th></tr><tr><td>a</td><td x:num="5">5.00</td></tr></table>', {
      cell: (c) => void calls.push(c),
    });
    expect(calls).toEqual([
      { text: 'H', tag: 'th', attributes: { colspan: '2', class: 'h' }, row: 0, col: 0, rowSpan: 1, colSpan: 2 },
      { text: 'a', tag: 'td', attributes: {}, row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      { text: '5.00', tag: 'td', attributes: { 'x:num': '5' }, row: 1, col: 1, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it('reports spans after clipping', () => {
    const spans: number[] = [];
    parseHTMLTable('<table><tr><td rowspan=9>a</td></tr><tr><td>b</td></tr></table>', { cell: (c) => void spans.push(c.rowSpan) });
    expect(spans).toEqual([2, 1]);
  });

  it('replaces values unless it returns undefined or null', () => {
    const html = '<table><tr><td x:num="1234.5">1,234.50</td><td>text</td><td data-v="0">zero</td></tr></table>';
    expect(rows(html, { cell: (c) => c.attributes['x:num'] })).toEqual([['1234.5', 'text', 'zero']]);
    expect(rows(html, { cell: (c) => c.attributes['data-v'] ?? null })).toEqual([['1,234.50', 'text', '0']]);
  });

  it('feeds repeated merged cells with the mapped value', () => {
    expect(rows('<table><tr><td colspan=2>a</td></tr></table>', { mergedCells: 'repeat', cell: (c) => c.text.toUpperCase() })).toEqual([['A', 'A']]);
  });
});

describe('parseHTMLTable: real-world clipboard HTML', () => {
  it('Excel for Windows', () => {
    expect(parseHTMLTable(fixture('excel-windows.html'))).toEqual({
      rows: [
        ['이름', 'Price', 'Merged block', '', 'R&D'],
        ['Kim', '1,234.50', '', '', '42'],
        ['first line\nsecond line', '   indented', 'This long text overflows', '', ''],
        ['00123', 'TRUE', '#DIV/0!', '0.5', '<tag> "q"'],
      ],
      merges: [{ row: 0, col: 2, rowSpan: 2, colSpan: 2 }],
    });
  });

  it('Excel raw numbers through the cell option', () => {
    const raw = parseHTMLTable(fixture('excel-windows.html'), {
      cell: ({ attributes, text }) => (attributes['x:num'] ? attributes['x:num'] : text),
    });
    expect(raw!.rows[1]).toEqual(['Kim', '1234.5', '', '', '42']);
  });

  it('Google Sheets', () => {
    expect(parseHTMLTable(fixture('google-sheets.html'))).toEqual({
      rows: [
        ['Product', 'Qty', 'Price'],
        ['Apple\nGreen', '3', '$1,234.50'],
        ['Total', '', '$3,703.50'],
        ['TRUE', '', 'two spaces'],
      ],
      merges: [{ row: 2, col: 0, rowSpan: 1, colSpan: 2 }],
    });
  });

  it('Google Sheets raw values through the cell option', () => {
    const table = parseHTMLTable(fixture('google-sheets.html'), {
      cell: ({ attributes }) => {
        const raw = attributes['data-sheets-value'];
        if (!raw) return undefined;
        const v = JSON.parse(raw) as Record<string, unknown>;
        return String(v['3'] ?? v['2'] ?? v['4']);
      },
    });
    expect(table!.rows[1]).toEqual(['Apple\nGreen', '3', '1234.5']);
    expect(table!.rows[3]).toEqual(['true', '', '  two spaces']);
  });

  it('LibreOffice Calc', () => {
    expect(parseHTMLTable(fixture('libreoffice.html'))).toEqual({
      rows: [
        ['City', 'Population', ''],
        ['Seoul\nKorea', '9411000', 'Capital\nregion'],
        ['Incheon', '2950000', ''],
      ],
      merges: [{ row: 1, col: 2, rowSpan: 2, colSpan: 1 }],
    });
  });

  it('Microsoft Word', () => {
    expect(parseHTMLTable(fixture('word.html'))).toEqual({
      rows: [
        ['Task', 'Notes'],
        ['Write docs', '1.      First paragraph\n\nSecond paragraph'],
      ],
      merges: [],
    });
  });

  it('a table selected on a web page', () => {
    expect(parseHTMLTable(fixture('browser-selection.html'))).toEqual({
      rows: [
        ['Rank', 'City', 'Population'],
        ['1', 'Seoul[1]', '9,411,000'],
        ['2', 'Busan', '3,349,000'],
      ],
      merges: [],
    });
  });
});

describe('parseHTMLTable: robustness', () => {
  const htmlish = fc.string({
    unit: fc.constantFrom(
      '<table>', '</table>', '<tr>', '</tr>', '<td>', '</td>', '<th>', '<tbody>', '</tbody>', '<thead>', '<caption>', '<td colspan=2>',
      '<td rowspan=0>', '<td rowspan=3>', '<br>', '<p>', '</p>', '<pre>', '</pre>', '<span hidden>', '</span>', '<!--', '-->', '<script>',
      '</script>', '<', '>', '&', '&amp;', '&#', ';', '"', "'", '=', ' ', '\n', 'a', 'b', '<![if x]>', '<![endif]>', '<col>', '</',
    ),
    maxLength: 40,
  });

  it('never throws and always returns a rectangular grid with valid merges', () => {
    fc.assert(
      fc.property(htmlish, (html) => {
        const table = parseHTMLTable(html);
        if (!table) return;
        const width = table.rows[0]?.length ?? 0;
        for (const row of table.rows) expect(row).toHaveLength(width);
        const used = new Set<string>();
        for (const m of table.merges) {
          expect(m.rowSpan * m.colSpan).toBeGreaterThan(1);
          expect(m.row + m.rowSpan).toBeLessThanOrEqual(table.rows.length);
          expect(m.col + m.colSpan).toBeLessThanOrEqual(width);
          for (let r = m.row; r < m.row + m.rowSpan; r++) {
            for (let c = m.col; c < m.col + m.colSpan; c++) {
              const key = `${r},${c}`;
              expect(used.has(key)).toBe(false);
              used.add(key);
            }
          }
        }
      }),
      { numRuns: 5000 },
    );
  });

  it('parses a large table quickly', () => {
    const body = Array.from({ length: 2000 }, (_, r) => `<tr>${Array.from({ length: 30 }, (_, c) => `<td class=xl65 style='height:15pt'>R${r}C${c}&amp;</td>`).join('')}</tr>`).join('\n');
    const start = performance.now();
    const table = parseHTMLTable(`<table>${body}</table>`)!;
    expect(performance.now() - start).toBeLessThan(1500);
    expect(table.rows).toHaveLength(2000);
    expect(table.rows[1999]![29]).toBe('R1999C29&');
  });

  it('stays linear with many raw-text elements and conditional comments', () => {
    const html = '<table><tr><td>' + '<style>x</style><![if a]>b<![endif]><!--c-->'.repeat(20000) + 'end</td></tr></table>';
    const start = performance.now();
    expect(rows(html)).toEqual([['end']]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('stays linear with many unclosed raw-text elements', () => {
    const html = '<table><tr><td>' + '<title>x</'.repeat(20000);
    const start = performance.now();
    parseHTMLTable(html);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('stringifyHTMLTable', () => {
  it('serialises a grid', () => {
    expect(stringifyHTMLTable([['a', 'b'], ['c', 'd']])).toBe(
      '<meta charset="utf-8"><table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
    );
  });

  it('escapes markup and encodes line breaks for Excel', () => {
    expect(stringifyHTMLTable([['<b>&</b>', 'a\nb']])).toContain(
      '<td>&lt;b&gt;&amp;&lt;/b&gt;</td><td>a<br style="mso-data-placement:same-cell">b</td>',
    );
  });

  it('marks cells with significant whitespace', () => {
    for (const value of ['  a', 'a  b', 'a ', ' a', 'a\tb', 'x\n y', 'x \ny', 'a\fb']) {
      expect(stringifyHTMLTable([[value]]), JSON.stringify(value)).toContain('style="white-space:pre-wrap"');
    }
    for (const value of ['a b', 'a\nb', '']) {
      expect(stringifyHTMLTable([[value]]), JSON.stringify(value)).not.toContain('white-space');
    }
  });

  it('pads ragged rows and converts values', () => {
    expect(stringifyHTMLTable([['a', 1], [null]])).toContain('<tr><td>a</td><td>1</td></tr><tr><td></td><td></td></tr>');
  });

  it('emits merges and header rows', () => {
    const html = stringifyHTMLTable(
      [
        ['H', '', 'x'],
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
      { merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }, { row: 1, col: 2, rowSpan: 2, colSpan: 1 }], headerRows: 1 },
    );
    expect(html).toBe(
      '<meta charset="utf-8"><table><tbody><tr><th colspan="2">H</th><th>x</th></tr><tr><td>a</td><td>b</td><td rowspan="2">c</td></tr><tr><td>d</td><td>e</td></tr></tbody></table>',
    );
  });

  it('validates merges', () => {
    const grid = [['a', 'b'], ['c', 'd']];
    expect(() => stringifyHTMLTable(grid, { merges: [{ row: 0, col: 0, rowSpan: 3, colSpan: 1 }] })).toThrow(/outside/);
    expect(() => stringifyHTMLTable(grid, { merges: [{ row: 0, col: 1, rowSpan: 1, colSpan: 2 }] })).toThrow(/outside/);
    expect(() => stringifyHTMLTable(grid, { merges: [{ row: 0, col: 0, rowSpan: 0, colSpan: 1 }] })).toThrow(/at least one/);
    expect(() =>
      stringifyHTMLTable(grid, { merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }, { row: 1, col: 0, rowSpan: 1, colSpan: 2 }] }),
    ).toThrow(/overlaps/);
    expect(() => stringifyHTMLTable(grid, { merges: [{ row: -1, col: 0, rowSpan: 1, colSpan: 1 }] })).toThrow(RangeError);
    expect(() => stringifyHTMLTable(grid, { merges: [{ row: 0.5, col: 0, rowSpan: 1, colSpan: 1 }] })).toThrow(RangeError);
    expect(() => stringifyHTMLTable(grid, { merges: [null as never] })).toThrow(TypeError);
    expect(() => stringifyHTMLTable(grid, { merges: {} as never })).toThrow(TypeError);
    expect(() => stringifyHTMLTable(grid, { headerRows: -1 })).toThrow(RangeError);
    expect(stringifyHTMLTable(grid, { merges: [{ row: 1, col: 1, rowSpan: 1, colSpan: 1 }] })).not.toContain('span');
  });
});

describe('HTML round-trip (property based)', () => {
  const chars = fc.constantFrom('a', 'Z', ' ', '  ', '\t', '\n', '\r\n', '<', '>', '&', '&amp;', '"', "'", '한', '😀', '\f', '<br>', '-->', '\u00a0x');
  const cellValue = fc.oneof(
    fc.string({ unit: chars, maxLength: 8 }),
    fc.string({ maxLength: 8 }),
    fc.string({ unit: 'binary', maxLength: 6 }),
  );
  const grid = fc
    .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }))
    .chain(([r, c]) => fc.array(fc.array(cellValue, { minLength: c, maxLength: c }), { minLength: r, maxLength: r }));
  const normalise = (value: string) => value.replace(/\r\n?/g, '\n');

  it('parseHTMLTable(stringifyHTMLTable(grid)) returns the grid', () => {
    fc.assert(
      fc.property(grid, (g) => {
        const parsed = parseHTMLTable(stringifyHTMLTable(g), { preserveNbsp: true })!;
        expect(parsed.rows).toEqual(g.map((row) => row.map(normalise)));
        expect(parsed.merges).toEqual([]);
      }),
      { numRuns: 3000 },
    );
  });

  it('round-trips merges', () => {
    const withMerges = grid.chain((g) => {
      const rows = g.length;
      const cols = g[0]!.length;
      return fc
        .record({ row: fc.integer({ min: 0, max: rows - 1 }), col: fc.integer({ min: 0, max: cols - 1 }) })
        .chain(({ row, col }) =>
          fc.record({
            row: fc.constant(row),
            col: fc.constant(col),
            rowSpan: fc.integer({ min: 1, max: rows - row }),
            colSpan: fc.integer({ min: 1, max: cols - col }),
          }),
        )
        .map((merge) => ({ g, merge }));
    });
    fc.assert(
      fc.property(withMerges, ({ g, merge }) => {
        const parsed = parseHTMLTable(stringifyHTMLTable(g, { merges: [merge] }), { preserveNbsp: true })!;
        const isMerge = merge.rowSpan > 1 || merge.colSpan > 1;
        expect(parsed.merges).toEqual(isMerge ? [merge] : []);
        const expected = g.map((row, r) =>
          row.map((value, c) => {
            const covered = r >= merge.row && r < merge.row + merge.rowSpan && c >= merge.col && c < merge.col + merge.colSpan;
            return covered && (r !== merge.row || c !== merge.col) ? '' : normalise(value);
          }),
        );
        expect(parsed.rows).toEqual(expected);
      }),
      { numRuns: 2000 },
    );
  });
});
