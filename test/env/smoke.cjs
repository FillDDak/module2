const run = require('./checks.cjs');
const g = require('gridclip');
run(g, `CommonJS require (${typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version})`).catch((e) => {
  console.error(e);
  process.exit(1);
});
