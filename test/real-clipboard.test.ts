// Clipboard contents captured from real applications (not reconstructed by hand).
// See test/fixtures/REAL-CAPTURES.md for how and where each one was captured.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseClipboard, parseHTMLTable, parseTSV } from '../src';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('Excel for Windows (Microsoft 365, 16.0.20430), real clipboard', () => {
  // The worksheet: A1:C1 merged, B3 has an Alt+Enter line break, A4 has two
  // leading and two trailing spaces and overflows into the empty B4, row 5 is
  // hidden, C3/C4/A6/C6 carry number formats, A7:A8 is merged vertically,
  // B7 holds a tab (CHAR(9)), B8 is the text '0012 and A9 ends with a line break.
  const rows = [
    ['병합 헤더', '', ''],
    ['이름', '메모', '금액'],
    ['홍길동', '첫째 줄\n둘째 줄', '1,234,567.89'],
    ['  앞뒤 공백  ', '', '50%'],
    // Row 5 is hidden: Excel leaves it out of both flavours.
    ['2024-01-15', '"따옴표" 포함', '(42)'],
    ['세로 병합', '탭\t문자', '2,469,135.78'],
    ['', '0012', 'TRUE'],
    ['끝 줄바꿈\n', '<b>not html</b> & 😀', ''],
  ];
  const merges = [
    { row: 0, col: 0, rowSpan: 1, colSpan: 3 },
    { row: 5, col: 0, rowSpan: 2, colSpan: 1 },
  ];

  it('as received by Chromium (CRLF, as written to CF_HTML / CF_UNICODETEXT)', () => {
    const result = parseClipboard({ text: fixture('excel-windows-real.txt'), html: fixture('excel-windows-real.html') });
    expect(result).toEqual({ rows, merges, source: 'text' });
  });

  it('as received by Firefox (LF line endings, regenerated style classes)', () => {
    const result = parseClipboard({
      text: fixture('excel-windows-real.firefox.txt'),
      html: fixture('excel-windows-real.firefox.html'),
    });
    expect(result).toEqual({ rows, merges, source: 'text' });
  });

  it('the text flavour on its own', () => {
    expect(parseTSV(fixture('excel-windows-real.txt'))).toEqual(rows);
  });

  it('the HTML flavour on its own follows the rendering', () => {
    // Rendered, the tab collapses to a space (white-space: nowrap) and the
    // final <br /> adds no line, so only those two cells differ from the text.
    const expected = rows.map((row) => [...row]);
    expected[5]![1] = '탭 문자';
    expected[7]![0] = '끝 줄바꿈';
    for (const name of ['excel-windows-real.html', 'excel-windows-real.firefox.html']) {
      expect(parseHTMLTable(fixture(name))).toEqual({ rows: expected, merges });
    }
  });

  it('reads the no-break spaces of mso-spacerun as plain spaces, as Excel itself does', () => {
    // Excel writes "  앞뒤 공백  " as <span style='mso-spacerun:yes'>&nbsp; </span>…&nbsp;&nbsp;
    // and pastes that HTML back as plain spaces, so preserveNbsp must not keep them.
    const html = fixture('excel-windows-real.html');
    expect(html).toContain("mso-spacerun:yes'>  </span>앞뒤 공백");
    expect(parseHTMLTable(html, { preserveNbsp: true })!.rows[3]![0]).toBe('  앞뒤 공백  ');
    const cell = (inner: string) => parseHTMLTable(`<table><tr><td>${inner}</td></tr></table>`, { preserveNbsp: true })!.rows[0]![0];
    expect(cell('<span style="mso-spacerun:yes">&nbsp;</span>')).toBe(' ');
    expect(cell('a<span style="mso-spacerun:yes"><b>&nbsp;&nbsp;</b></span>b')).toBe('a  b');
    expect(cell('a&nbsp;<span style="mso-spacerun:no">&nbsp;</span>b')).toBe('a  b');
  });

  it("treats colspan with mso-ignore:colspan (text overflowing into empty cells) as no merge", () => {
    const html = fixture('excel-windows-real.html');
    expect(html).toContain("colspan=2 style='height:17.0pt;mso-ignore:colspan'");
    expect(parseHTMLTable(html)!.merges.some((m) => m.row === 3 || m.row === 7)).toBe(false);
  });
});
