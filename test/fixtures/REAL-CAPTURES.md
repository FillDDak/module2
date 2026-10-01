# Real clipboard captures

The other fixtures in this directory were reconstructed by hand. The files below
were captured from real applications and are kept byte for byte (see
`.gitattributes`); only the user name in Excel's temporary-file `href`s was
replaced with `user`.

## Excel for Windows

- `excel-windows-real.html`, `excel-windows-real.txt`
- `excel-windows-real.firefox.html`, `excel-windows-real.firefox.txt`

Captured on 2026-10-01 on Windows 11 (Korean locale) with Microsoft 365 Excel
16.0.20430.20092. A new workbook was filled through COM automation:

| | A | B | C |
| --- | --- | --- | --- |
| 1 | `병합 헤더` (A1:C1 merged) | | |
| 2 | `이름` | `메모` | `금액` |
| 3 | `홍길동` | `첫째 줄` Alt+Enter `둘째 줄` | `1234567.891` as `#,##0.00` |
| 4 | `  앞뒤 공백  ` (overflows into B4) | | `0.5` as `0%` |
| 5 (hidden) | `숨김 행` | `hidden` | `1` |
| 6 | `=DATE(2024,1,15)` as `yyyy-mm-dd` | `"따옴표" 포함` | `-42` as `0;(0)` |
| 7 | `세로 병합` (A7:A8 merged) | `="탭"&CHAR(9)&"문자"` | `=C3*2` |
| 8 | | `'0012` | `TRUE` |
| 9 | `끝 줄바꿈` + Alt+Enter | `<b>not html</b> & 😀` | |

A1:C9 was copied with `Range.Copy()` (the same as Ctrl+C), then pasted into a
page in headed Chromium 141 (`*.html`/`*.txt`: `text/plain` is byte-identical
to the Win32 `CF_UNICODETEXT`) and headed Firefox 142 (`*.firefox.*`, which
turns CRLF into LF and makes Excel re-render the HTML with other class names).

What real Excel does that the reconstructed `excel-windows.html` does not show:

- the hidden row 5 is left out of both flavours;
- text overflowing into empty neighbours is written as `colspan=2 style='mso-ignore:colspan'`;
- leading/trailing spaces become `<span style='mso-spacerun:yes'>` holding
  `&nbsp;` + space pairs (U+00A0, U+0020), which Excel reads back as plain spaces;
- line breaks are `<br />` followed by a newline and indentation; a final line
  break is a trailing `<br />` (the text flavour quotes it as `"끝 줄바꿈\n"`);
- the tab in B7 is a raw tab inside a `white-space:nowrap` cell (so it renders as a space);
- the emoji is `&#128512;`; Korean text is raw UTF-8 and the font is the localized `맑은 고딕`;
- no `x:num`, `x:str`, `x:bool` or `x:fmla` attributes (those appear in saved `.htm` files).

## Reproducing

`examples/clipboard-capture.html` records everything a paste event exposes and
saves it as JSON. Serve the repository root (`npm run build && npx http-server .`),
open the page, copy cells in the application and paste into the page.
