// Drives examples/demo.html like a user: select, copy, clear, paste.
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { browserName, clipboardUnsupported, launch } from './harness.mjs';

let ctx;
before(async () => {
  ctx = await launch();
});
after(async () => {
  await ctx?.close();
});

it('copies a selection with merged cells and pastes it back', { skip: clipboardUnsupported }, async () => {
  const { page, origin } = ctx;
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.goto(`${origin}/examples/demo.html`);
  await page.click('#sample');
  await page.click('td[data-r="0"][data-c="0"]');
  await page.click('td[data-r="4"][data-c="5"]', { modifiers: ['Shift'] });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyC`);
  assert.match(await page.textContent('#log'), /Copied 5×6 cells with 1 merged block/);

  const clipboard = await page.evaluate(() => window.gridclip.readFromClipboard());
  assert.equal(clipboard.rows.length, 5);
  assert.deepEqual(clipboard.merges, [{ row: 0, col: 0, rowSpan: 1, colSpan: 6 }]);
  assert.equal(clipboard.rows[2][5], 'Best quarter\nso far');

  await page.click('#clear');
  await page.click('td[data-r="1"][data-c="0"]');
  await page.keyboard.press(`${modifier}+KeyV`);
  assert.match(await page.textContent('#log'), /Pasted 5×6 cells from the text flavour, 1 merged block/);
  assert.equal(await page.getAttribute('td[data-r="1"][data-c="0"]', 'colspan'), '6');
  assert.equal(await page.textContent('td[data-r="3"][data-c="0"]'), '서울');
  assert.equal(await page.textContent('td[data-r="5"][data-c="5"]'), '"approx."');

  // Single value into a larger selection fills it.
  await page.evaluate(() => navigator.clipboard.writeText('x'));
  await page.click('td[data-r="7"][data-c="0"]');
  await page.click('td[data-r="7"][data-c="2"]', { modifiers: ['Shift'] });
  await page.keyboard.press(`${modifier}+KeyV`);
  for (const c of [0, 1, 2]) assert.equal(await page.textContent(`td[data-r="7"][data-c="${c}"]`), 'x');

  await page.click('#sample');
  await page.click('td[data-r="1"][data-c="0"]');
  await page.click('td[data-r="4"][data-c="5"]', { modifiers: ['Shift'] });
  // docs/demo.png is the README screenshot; keep it rendered by one engine.
  if (browserName === 'chromium') await page.screenshot({ path: fileURLToPath(new URL('../../docs/demo.png', import.meta.url)) });
});
