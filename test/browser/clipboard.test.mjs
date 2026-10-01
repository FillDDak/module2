// End-to-end tests against the real system clipboard in Chromium:
// keyboard copy/paste, the Async Clipboard API and the execCommand fallback.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { launch } from './harness.mjs';

let ctx;
before(async () => {
  ctx = await launch();
});
after(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.gridclip && window.gridclipESM);
});

const GRID = [
  ['이름', 'Note', 'Merged', ''],
  ['  leading spaces', 'multi\nline', 'tab\there', '"quoted"'],
  ['<b>not html</b>', 'a & b', '😀 emoji', ''],
];
const MERGES = [{ row: 0, col: 2, rowSpan: 1, colSpan: 2 }];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

describe('keyboard copy and paste', () => {
  it('copies with setClipboardData in a copy handler and pastes with parseClipboard', async () => {
    const { page } = ctx;
    await page.evaluate(
      ({ grid, merges }) => {
        const { setClipboardData, parseClipboard } = window.gridclipESM;
        document.getElementById('copy-source').addEventListener('copy', (event) => setClipboardData(event, grid, { merges }));
        document.getElementById('paste-target').addEventListener('paste', (event) => {
          window.pasted = parseClipboard(event);
          event.preventDefault();
        });
      },
      { grid: GRID, merges: MERGES },
    );
    await page.focus('#copy-source');
    await page.keyboard.press(`${modifier}+KeyC`);
    await page.focus('#paste-target');
    await page.keyboard.press(`${modifier}+KeyV`);
    const pasted = await page.waitForFunction(() => window.pasted).then((h) => h.jsonValue());
    assert.deepEqual(pasted, { rows: GRID, merges: MERGES, source: 'text' });
  });

  it('cut events work the same way', async () => {
    const { page } = ctx;
    await page.evaluate((grid) => {
      document.getElementById('copy-source').addEventListener('cut', (event) => window.gridclip.setClipboardData(event, grid));
    }, GRID);
    await page.focus('#copy-source');
    await page.keyboard.press(`${modifier}+KeyX`);
    const read = await page.evaluate(() => window.gridclip.readFromClipboard());
    assert.deepEqual(read.rows, GRID);
  });

  it('pastes the HTML flavour into a contenteditable as a real table', async () => {
    const { page } = ctx;
    await page.evaluate(
      ({ grid, merges }) => window.gridclip.copyToClipboard(grid, { merges }),
      { grid: GRID, merges: MERGES },
    );
    await page.focus('#rich-target');
    await page.keyboard.press(`${modifier}+KeyV`);
    const result = await page.evaluate(() => {
      const target = document.getElementById('rich-target');
      const table = target.querySelector('table');
      return {
        hasTable: !!table,
        colspan: table?.querySelector('td[colspan]')?.getAttribute('colspan'),
        reparsed: table && window.gridclip.parseHTMLTable(target.innerHTML),
      };
    });
    assert.equal(result.hasTable, true);
    assert.equal(result.colspan, '2');
    // The browser's sanitised, re-serialised table still parses to the same grid.
    assert.deepEqual(result.reparsed, { rows: GRID, merges: MERGES });
  });

  it('pastes the text flavour into a textarea as TSV', async () => {
    const { page } = ctx;
    await page.evaluate((grid) => window.gridclip.copyToClipboard(grid), GRID);
    await page.focus('#paste-target');
    await page.keyboard.press(`${modifier}+KeyV`);
    // Textareas normalise line endings to \n, whatever the platform clipboard uses.
    const value = await page.inputValue('#paste-target');
    assert.equal(value, await page.evaluate((grid) => window.gridclip.stringifyTSV(grid), GRID));
  });
});

describe('Async Clipboard API', () => {
  it('round-trips both flavours through the system clipboard', async () => {
    const { page } = ctx;
    const result = await page.evaluate(
      async ({ grid, merges }) => {
        const method = await window.gridclip.copyToClipboard(grid, { merges });
        const items = await navigator.clipboard.read();
        const types = items.flatMap((item) => item.types);
        const html = await (await items[0].getType('text/html')).text();
        const read = await window.gridclip.readFromClipboard();
        return { method, types, html, read };
      },
      { grid: GRID, merges: MERGES },
    );
    assert.equal(result.method, 'clipboard-api');
    assert.ok(result.types.includes('text/plain') && result.types.includes('text/html'), result.types.join());
    assert.match(result.html, /<table>/);
    assert.deepEqual(result.read, { rows: GRID, merges: MERGES, source: 'text' });
  });

  it('reads clipboard content written by other apps (simulated Google Sheets copy)', async () => {
    const { page } = ctx;
    const read = await page.evaluate(async () => {
      const html =
        '<google-sheets-html-origin><style>td{}</style><table><tbody><tr><td colspan="2">Total</td></tr><tr><td>a<br>b</td><td>1</td></tr></tbody></table>';
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['Total\t\n"a\nb"\t1'], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return window.gridclip.readFromClipboard();
    });
    assert.deepEqual(read, {
      rows: [
        ['Total', ''],
        ['a\nb', '1'],
      ],
      merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      source: 'text',
    });
  });

  it('falls back to readText when only text is on the clipboard', async () => {
    const { page } = ctx;
    const read = await page.evaluate(async () => {
      await navigator.clipboard.writeText('x\ty\nz\tw');
      return window.gridclip.readFromClipboard();
    });
    assert.deepEqual(read, { rows: [['x', 'y'], ['z', 'w']], merges: [], source: 'text' });
  });
});

describe('fallbacks', () => {
  it('uses execCommand when the Async Clipboard API is missing', async () => {
    const { page } = ctx;
    await page.evaluate((grid) => {
      const realRead = navigator.clipboard.read.bind(navigator.clipboard);
      window.realRead = realRead;
      // Simulate an older browser or a non-secure context.
      delete window.ClipboardItem;
      document.getElementById('copy-source').addEventListener('click', async () => {
        window.copyResult = await window.gridclip.copyToClipboard(grid).catch((e) => 'error: ' + e.message);
      });
      // A focused input with a selection, which the fallback must restore.
      const input = document.getElementById('paste-target');
      input.value = 'keep me';
      input.focus();
      input.setSelectionRange(0, 4);
    }, GRID);
    await page.click('#copy-source'); // execCommand needs a user gesture
    const result = await page.waitForFunction(() => window.copyResult).then((h) => h.jsonValue());
    assert.equal(result, 'exec-command');
    const { read, textareas } = await page.evaluate(async () => {
      const items = await window.realRead();
      const text = await (await items[0].getType('text/plain')).text();
      const html = await (await items[0].getType('text/html')).text();
      return { read: window.gridclip.parseClipboard({ text, html }), textareas: document.querySelectorAll('textarea').length };
    });
    assert.deepEqual(read.rows, GRID);
    assert.equal(textareas, 1, 'the temporary textarea is removed');
  });

  it('uses writeText when only text can be written', async () => {
    const { page } = ctx;
    const result = await page.evaluate(async (grid) => {
      delete window.ClipboardItem;
      document.execCommand = () => false;
      const method = await window.gridclip.copyToClipboard(grid);
      return { method, text: await navigator.clipboard.readText() };
    }, GRID);
    assert.equal(result.method, 'write-text');
    // The system clipboard may convert line endings (Windows stores CRLF), so
    // compare what the text means rather than its exact bytes.
    assert.deepEqual(await ctx.page.evaluate((text) => window.gridclip.parseTSV(text), result.text), GRID);
  });

  it('rejects with a helpful error when nothing works', async () => {
    const { page } = ctx;
    const message = await page.evaluate(async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
      document.execCommand = () => false;
      return window.gridclip.copyToClipboard([['x']]).then(
        () => 'resolved',
        (error) => error.message,
      );
    });
    assert.match(message, /unable to write to the clipboard/);
  });
});

describe('bundles', () => {
  it('the IIFE and ESM builds expose the same API', async () => {
    const keys = await ctx.page.evaluate(() => [Object.keys(window.gridclip).sort(), Object.keys(window.gridclipESM).sort()]);
    assert.deepEqual(keys[0], keys[1]);
    assert.deepEqual(keys[0], [
      'applyPaste', 'copyToClipboard', 'parseClipboard', 'parseHTMLTable', 'parseTSV', 'readFromClipboard', 'setClipboardData',
      'sliceGrid', 'stringifyClipboard', 'stringifyHTMLTable', 'stringifyTSV',
    ]);
  });
});
