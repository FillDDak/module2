import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, parseClipboard, readFromClipboard, setClipboardData, stringifyClipboard } from '../src';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

class FakeDataTransfer {
  data = new Map<string, string>();
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.data.set(k, v);
  }
  getData(type: string) {
    return this.data.get(type) ?? '';
  }
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
}

describe('parseClipboard: sources', () => {
  const text = 'a\tb\nc\td';
  const expected = { rows: [['a', 'b'], ['c', 'd']], merges: [], source: 'text' };

  it('reads a ClipboardEvent-like object', () => {
    expect(parseClipboard({ clipboardData: new FakeDataTransfer({ 'text/plain': text }) })).toEqual(expected);
  });

  it('reads a DragEvent-like object', () => {
    expect(parseClipboard({ dataTransfer: new FakeDataTransfer({ 'text/plain': text }) })).toEqual(expected);
  });

  it('reads a DataTransfer', () => {
    expect(parseClipboard(new FakeDataTransfer({ 'text/plain': text }))).toEqual(expected);
  });

  it('reads plain strings', () => {
    expect(parseClipboard({ text })).toEqual(expected);
    expect(parseClipboard({ text, html: null })).toEqual(expected);
  });

  it('falls back to the legacy "Text" format', () => {
    expect(parseClipboard(new FakeDataTransfer({ Text: text }))).toEqual(expected);
  });

  it('survives getData throwing or returning junk', () => {
    const broken = {
      getData: (type: string) => {
        if (type === 'text/html') throw new Error('denied');
        return type === 'text/plain' ? (undefined as unknown as string) : 'x';
      },
    };
    expect(parseClipboard(broken)).toEqual({ rows: [['x']], merges: [], source: 'text' });
  });

  it('returns an empty result for empty or missing data', () => {
    const empty = { rows: [], merges: [], source: 'none' };
    expect(parseClipboard({ clipboardData: null })).toEqual(empty);
    expect(parseClipboard({ dataTransfer: null })).toEqual(empty);
    expect(parseClipboard({})).toEqual(empty);
    expect(parseClipboard(new FakeDataTransfer({ Files: 'x' }))).toEqual(empty);
    expect(parseClipboard({ html: '<p>no table</p>' })).toEqual(empty);
    expect(parseClipboard({ html: '<table></table>' })).toEqual(empty);
  });

  it('rejects invalid input and options', () => {
    expect(() => parseClipboard(null as never)).toThrow(TypeError);
    expect(() => parseClipboard('text' as never)).toThrow(TypeError);
    expect(() => parseClipboard({ text }, { prefer: 'xml' as 'auto' })).toThrow(TypeError);
    expect(() => parseClipboard({ text }, { delimiter: '"' })).toThrow(TypeError);
    expect(() => parseClipboard({ text }, { mergedCells: 'x' as 'empty' })).toThrow(TypeError);
  });
});

describe('parseClipboard: choosing a flavour', () => {
  const html = '<table><tr><td colspan=2>m</td></tr><tr><td>a</td><td>b</td></tr></table>';
  const text = 'm\t\na\tb';

  it('combines exact text values with HTML merges when the shapes agree', () => {
    expect(parseClipboard({ text: '  m\t\na\tb', html })).toEqual({
      rows: [['  m', ''], ['a', 'b']],
      merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      source: 'text',
    });
  });

  it('repeats merged values on text rows too', () => {
    expect(parseClipboard({ text, html }, { mergedCells: 'repeat' }).rows).toEqual([['m', 'm'], ['a', 'b']]);
  });

  it('uses the HTML table when the text has a different shape', () => {
    // Rich-text apps write in-cell line breaks unquoted, splitting rows.
    const result = parseClipboard({ text: 'line1\nline2\tb', html: '<table><tr><td>line1<br>line2</td><td>b</td></tr></table>' });
    expect(result).toEqual({ rows: [['line1\nline2', 'b']], merges: [], source: 'html' });
  });

  it('uses the HTML values when a cell mapper is given', () => {
    const result = parseClipboard({ text: 'shown', html: '<table><tr><td data-raw="raw">shown</td></tr></table>' }, { cell: (c) => c.attributes['data-raw'] });
    expect(result).toEqual({ rows: [['raw']], merges: [], source: 'html' });
  });

  it('uses the text when the HTML has more than a table', () => {
    const result = parseClipboard({ text: 'Intro\nx', html: '<p>Intro</p><table><tr><td>x</td></tr></table>' });
    expect(result).toEqual({ rows: [['Intro'], ['x']], merges: [], source: 'text' });
    const after = parseClipboard({ text: 'x\nOutro', html: '<table><tr><td>x</td></tr></table><p>Outro</p>' });
    expect(after.source).toBe('text');
    const stray = parseClipboard({ text: 'junk\nx', html: '<table>junk<tr><td>x</td></tr></table>' });
    expect(stray.source).toBe('text');
  });

  it('does not count invisible or whitespace-only content as outside text', () => {
    const html = `<html><head><title>t</title><style>td{}</style><script>x</script></head><body>
      &nbsp;<!--StartFragment--><table><style>td{}</style><tr><td>x</td></tr></table><!--EndFragment-->
      <div hidden>hidden</div><span style="display:none">gone</span></body></html>`;
    expect(parseClipboard({ text: 'x', html }).source).toBe('text');
    expect(parseClipboard({ text: 'other shape\ny', html })).toEqual({ rows: [['x']], merges: [], source: 'html' });
  });

  it('uses the HTML table when there is no text, whatever else the HTML contains', () => {
    expect(parseClipboard({ html: '<p>Intro</p><table><tr><td>x</td></tr></table>' })).toEqual({ rows: [['x']], merges: [], source: 'html' });
  });

  it("prefer: 'html' always takes the table", () => {
    expect(parseClipboard({ text: 'Intro\nx', html: '<p>Intro</p><table><tr><td>x</td></tr></table>' }, { prefer: 'html' }).source).toBe('html');
    expect(parseClipboard({ text: '  m\t\na\tb', html }, { prefer: 'html' }).rows).toEqual([['m', ''], ['a', 'b']]);
    expect(parseClipboard({ text: 'fallback', html: '<p>no table</p>' }, { prefer: 'html' }).source).toBe('text');
  });

  it("prefer: 'text' ignores the HTML unless there is no text", () => {
    expect(parseClipboard({ text, html }, { prefer: 'text' })).toEqual({ rows: [['m', ''], ['a', 'b']], merges: [], source: 'text' });
    expect(parseClipboard({ html }, { prefer: 'text' }).source).toBe('html');
  });

  it('passes parsing options through', () => {
    expect(parseClipboard({ text: 'a;b' }, { delimiter: ';' }).rows).toEqual([['a', 'b']]);
    expect(parseClipboard({ text: 'a\tb\nc' }, { rectangular: false }).rows).toEqual([['a', 'b'], ['c']]);
    expect(parseClipboard({ html: '<table><tr><td>a&nbsp;b</td></tr></table>' }, { preserveNbsp: true }).rows).toEqual([['a\u00a0b']]);
  });
});

describe('parseClipboard: real-world clipboard contents', () => {
  it('Excel: TSV values with HTML merges', () => {
    const text = '이름\tPrice\tMerged block\t\tR&D\r\nKim\t1,234.50\t\t\t42\r\n"first line\nsecond line"\t   indented\tThis long text overflows\t\t\r\n00123\tTRUE\t#DIV/0!\t0.5\t<tag> "q"\r\n';
    const result = parseClipboard({ text, html: fixture('excel-windows.html') });
    expect(result.source).toBe('text');
    expect(result.merges).toEqual([{ row: 0, col: 2, rowSpan: 2, colSpan: 2 }]);
    expect(result.rows[2]).toEqual(['first line\nsecond line', '   indented', 'This long text overflows', '', '']);
  });

  it('Google Sheets: exact whitespace from the text flavour', () => {
    const text = 'Product\tQty\tPrice\n"Apple\nGreen"\t3\t$1,234.50\nTotal\t\t$3,703.50\nTRUE\t\t  two spaces';
    const result = parseClipboard({ text, html: fixture('google-sheets.html') });
    expect(result).toEqual({
      rows: [
        ['Product', 'Qty', 'Price'],
        ['Apple\nGreen', '3', '$1,234.50'],
        ['Total', '', '$3,703.50'],
        ['TRUE', '', '  two spaces'],
      ],
      merges: [{ row: 2, col: 0, rowSpan: 1, colSpan: 2 }],
      source: 'text',
    });
  });

  it('a web page table whose plain text includes the caption', () => {
    const text = 'Largest cities\nRank\tCity\tPopulation\n1\tSeoul[1]\t9,411,000\n2\tBusan\t3,349,000';
    const result = parseClipboard({ text, html: fixture('browser-selection.html') });
    expect(result.source).toBe('html');
    expect(result.rows[0]).toEqual(['Rank', 'City', 'Population']);
  });

  it('Word: paragraphs inside cells', () => {
    const text = 'Task\tNotes\nWrite docs\t1.\tFirst paragraph\n\nSecond paragraph';
    const result = parseClipboard({ text, html: fixture('word.html') });
    expect(result.source).toBe('html');
    expect(result.rows[1]![1]).toBe('1.      First paragraph\n\nSecond paragraph');
  });
});

describe('stringifyClipboard / setClipboardData', () => {
  const grid = [['a', 'b\nc']];

  it('produces both flavours', () => {
    const payload = stringifyClipboard(grid, { lineEnding: '\r\n', headerRows: 1 });
    expect(payload.text).toBe('a\t"b\nc"');
    expect(payload.html).toContain('<th>a</th>');
  });

  it('writes to a ClipboardEvent and cancels it', () => {
    const data = new FakeDataTransfer();
    const preventDefault = vi.fn();
    const payload = setClipboardData({ clipboardData: data, preventDefault }, grid);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(data.getData('text/plain')).toBe(payload.text);
    expect(data.getData('text/html')).toBe(payload.html);
    expect(parseClipboard(data).rows).toEqual(grid);
  });

  it('writes to a DataTransfer', () => {
    const data = new FakeDataTransfer();
    setClipboardData(data, grid);
    expect(data.getData('text/plain')).toBe('a\t"b\nc"');
  });

  it('works with events that cannot be cancelled', () => {
    const data = new FakeDataTransfer();
    expect(() => setClipboardData({ clipboardData: data }, grid)).not.toThrow();
  });

  it('round-trips merges through the event', () => {
    const data = new FakeDataTransfer();
    const merges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }];
    setClipboardData(data, [['m', ''], ['x', 'y']], { merges });
    expect(parseClipboard(data)).toEqual({ rows: [['m', ''], ['x', 'y']], merges, source: 'text' });
  });

  it('rejects targets without clipboard data', () => {
    expect(() => setClipboardData({ clipboardData: null }, grid)).toThrow(/no clipboardData/);
    expect(() => setClipboardData(null as never, grid)).toThrow(TypeError);
    expect(() => setClipboardData({} as never, grid)).toThrow(TypeError);
  });
});

// ---- Async Clipboard API ----------------------------------------------------

class FakeBlob {
  constructor(
    readonly parts: string[],
    readonly options: { type: string },
  ) {}
  text() {
    return Promise.resolve(this.parts.join(''));
  }
}
class FakeClipboardItem {
  constructor(readonly items: Record<string, FakeBlob>) {}
  get types() {
    return Object.keys(this.items);
  }
  getType(type: string) {
    return Promise.resolve(this.items[type]!);
  }
}

function installNavigator(clipboard: object | undefined) {
  vi.stubGlobal('navigator', clipboard === undefined ? {} : { clipboard });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyToClipboard', () => {
  it('writes both flavours with the Async Clipboard API', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    installNavigator({ write });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('Blob', FakeBlob);
    await expect(copyToClipboard([['a', 'b']])).resolves.toBe('clipboard-api');
    const item = write.mock.calls[0]![0][0] as FakeClipboardItem;
    expect(item.types).toEqual(['text/plain', 'text/html']);
    expect(await item.items['text/plain']!.text()).toBe('a\tb');
    expect(item.items['text/html']!.options.type).toBe('text/html');
  });

  it('falls back to execCommand when the Async Clipboard API fails', async () => {
    installNavigator({ write: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('Blob', FakeBlob);
    const doc = fakeDocument(true);
    vi.stubGlobal('document', doc);
    await expect(copyToClipboard([['x']])).resolves.toBe('exec-command');
    expect(doc.written.get('text/plain')).toBe('x');
    expect(doc.written.get('text/html')).toContain('<td>x</td>');
    expect(doc.listeners.size).toBe(0);
    expect(doc.body.children).toHaveLength(0);
    expect(doc.restoredFocus).toBe(true);
    expect(doc.selectionRestored).toBe(true);
  });

  it('survives execCommand throwing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installNavigator({ writeText });
    const doc = fakeDocument(true);
    doc.execCommand = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('document', doc);
    await expect(copyToClipboard([['x']])).resolves.toBe('write-text');
    expect(doc.listeners.size).toBe(0);
    expect(doc.body.children).toHaveLength(0);
  });

  it('does not report success when the copy event was not delivered', async () => {
    installNavigator({ writeText: vi.fn().mockResolvedValue(undefined) });
    const doc = fakeDocument(true);
    doc.execCommand = () => true; // claims success but never fires `copy`
    vi.stubGlobal('document', doc);
    await expect(copyToClipboard([['x']])).resolves.toBe('write-text');
  });

  it('falls back to writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installNavigator({ writeText });
    vi.stubGlobal('document', fakeDocument(false));
    await expect(copyToClipboard([['x', 'y']])).resolves.toBe('write-text');
    expect(writeText).toHaveBeenCalledWith('x\ty');
  });

  it('rejects with the underlying error when everything fails', async () => {
    const denied = new Error('denied');
    installNavigator({ writeText: vi.fn().mockRejectedValue(denied) });
    const promise = copyToClipboard([['x']]);
    await expect(promise).rejects.toThrow('unable to write to the clipboard');
    await expect(promise.catch((e: Error) => e.cause)).resolves.toBe(denied);
  });

  it('rejects when no clipboard API exists (e.g. on the server)', async () => {
    installNavigator(undefined);
    await expect(copyToClipboard([['x']])).rejects.toThrow(/no clipboard API available/);
  });

  it('rejects invalid grids before touching the clipboard', async () => {
    const write = vi.fn();
    installNavigator({ write });
    await expect(copyToClipboard('nope' as never)).rejects.toThrow(TypeError);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('readFromClipboard', () => {
  it('reads both flavours', async () => {
    const item = new FakeClipboardItem({
      'text/html': new FakeBlob(['<table><tr><td colspan=2>m</td></tr></table>'], { type: 'text/html' }),
      'text/plain': new FakeBlob(['m\t'], { type: 'text/plain' }),
    });
    installNavigator({ read: vi.fn().mockResolvedValue([item]) });
    await expect(readFromClipboard()).resolves.toEqual({
      rows: [['m', '']],
      merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      source: 'text',
    });
  });

  it('collects flavours across several items and ignores other types', async () => {
    const items = [
      new FakeClipboardItem({ 'image/png': new FakeBlob(['png'], { type: 'image/png' }) }),
      new FakeClipboardItem({ 'text/plain': new FakeBlob(['a\tb'], { type: 'text/plain' }) }),
    ];
    installNavigator({ read: vi.fn().mockResolvedValue(items) });
    await expect(readFromClipboard()).resolves.toEqual({ rows: [['a', 'b']], merges: [], source: 'text' });
  });

  it('falls back to readText', async () => {
    installNavigator({ read: vi.fn().mockRejectedValue(new Error('denied')), readText: vi.fn().mockResolvedValue('x\ty') });
    await expect(readFromClipboard()).resolves.toEqual({ rows: [['x', 'y']], merges: [], source: 'text' });
    installNavigator({ readText: vi.fn().mockResolvedValue('') });
    await expect(readFromClipboard()).resolves.toEqual({ rows: [], merges: [], source: 'none' });
  });

  it('passes options through', async () => {
    installNavigator({ readText: vi.fn().mockResolvedValue('a,b') });
    await expect(readFromClipboard({ delimiter: ',' })).resolves.toMatchObject({ rows: [['a', 'b']] });
  });

  it('rejects when reading is impossible', async () => {
    installNavigator(undefined);
    await expect(readFromClipboard()).rejects.toThrow(/not available/);
    installNavigator({});
    await expect(readFromClipboard()).rejects.toThrow(/not available/);
    const denied = new Error('denied');
    installNavigator({ read: vi.fn().mockRejectedValue(denied), readText: vi.fn().mockRejectedValue(new Error('also denied')) });
    await expect(readFromClipboard().catch((e: Error) => e.cause)).resolves.toBe(denied);
  });
});

/** A minimal fake of the DOM pieces execCommandCopy touches. */
function fakeDocument(execWorks: boolean) {
  const listeners = new Map<string, (event: unknown) => void>();
  const written = new Map<string, string>();
  const ranges = [{ id: 'range' }];
  const selection = {
    rangeCount: 1,
    getRangeAt: (i: number) => ranges[i],
    removeAllRanges: () => (selection.rangeCount = 0),
    addRange: () => {
      selection.rangeCount++;
      doc.selectionRestored = true;
    },
  };
  const body = {
    children: [] as unknown[],
    appendChild(el: unknown) {
      this.children.push(el);
    },
  };
  const active = { focus: () => (doc.restoredFocus = true) };
  const doc = {
    listeners,
    written,
    body,
    restoredFocus: false,
    selectionRestored: false,
    activeElement: active,
    getSelection: () => selection,
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    createElement: () => {
      const el = {
        value: '',
        style: { cssText: '' },
        setAttribute: () => {},
        select: () => {},
        remove: () => body.children.splice(body.children.indexOf(el), 1),
      };
      return el;
    },
    execCommand: (command: string) => {
      if (command !== 'copy' || !execWorks) return false;
      listeners.get('copy')?.({
        clipboardData: { setData: (type: string, value: string) => written.set(type, value) },
        preventDefault: () => {},
        stopImmediatePropagation: () => {},
      });
      return true;
    },
  };
  return doc;
}
