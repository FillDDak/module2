// Shared helpers for the browser tests: a static file server and a browser page.
// Pick the engine with BROWSER=chromium|firefox|webkit (default: chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as playwright from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json' };

export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    try {
      const body = await readFile(join(root, path));
      res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://localhost:${server.address().port}` };
}

export const browserName = process.env.BROWSER || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) {
  throw new Error(`BROWSER must be chromium, firefox or webkit, received ${JSON.stringify(browserName)}`);
}

/**
 * Why the system-clipboard tests cannot run in this browser, or false. Pass it
 * as node:test's `skip` option. Playwright's WebKit for Windows (the WinCairo
 * port, not Safari) has no working clipboard: `navigator.clipboard.read()` and
 * `readText()` reject, and paste events see empty `getData()` results even for
 * data written by the same page or copied from Excel (checked on Windows 11).
 */
export const clipboardUnsupported =
  browserName === 'webkit' && process.platform === 'win32'
    ? "Playwright's WebKit for Windows has no working system clipboard (reads reject, paste events are empty)"
    : false;

export async function launch() {
  const browser =
    browserName === 'chromium'
      ? await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
      : await playwright[browserName].launch();
  const { server, origin } = await startServer();
  const context = await browser.newContext();
  // Playwright only knows the clipboard permissions in Chromium; Firefox throws
  // "Unknown permission" and WebKit has no permission prompt to grant.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('[pageerror]', error));
  await page.goto(`${origin}/test/browser/page.html`);
  await page.waitForFunction(() => window.gridclip && window.gridclipESM);
  return {
    browser,
    browserName,
    page,
    origin,
    async close() {
      await browser.close();
      server.close();
    },
  };
}
