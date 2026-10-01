// Runs the browser tests once per engine: node test/browser/run.mjs [chromium] [firefox] [webkit]
// (all three by default). Cross-platform replacement for `BROWSER=x node --test …`,
// which cmd.exe cannot run, and for shell globs, which cmd.exe does not expand.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => fileURLToPath(new URL(name, import.meta.url)));
const browsers = process.argv.length > 2 ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];

const failed = [];
for (const browser of browsers) {
  console.log(`\n# Browser tests in ${browser}\n`);
  const { status } = spawnSync(process.execPath, ['--test', ...files], {
    stdio: 'inherit',
    env: { ...process.env, BROWSER: browser },
  });
  if (status !== 0) failed.push(browser);
}
if (failed.length) {
  console.error(`\nBrowser tests failed in: ${failed.join(', ')}`);
  process.exit(1);
}
