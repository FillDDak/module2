import { createRequire } from 'node:module';
import * as g from 'gridclip';
import { parseTSV } from 'gridclip';
const run = createRequire(import.meta.url)('./checks.cjs');
if (typeof parseTSV !== 'function') throw new Error('named export missing');
const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : typeof Deno !== 'undefined' ? `deno ${Deno.version.deno}` : `node ${process.version}`;
await run(g, `ESM import (${runtime})`);
