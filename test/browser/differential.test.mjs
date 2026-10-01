// Differential tests: gridclip's DOM-free HTML parser against Chromium's own
// HTML parser and layout engine, on thousands of generated inputs.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launch } from './harness.mjs';

/** Small seeded PRNG so failures are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

const SEED = Number(process.env.SEED ?? 20240501);
const RUNS = Number(process.env.RUNS ?? 1);

let ctx;
before(async () => {
  ctx = await launch();
});
after(async () => {
  await ctx?.close();
});

function reportMismatches(mismatches, label) {
  if (mismatches.length) {
    const sample = mismatches.slice(0, 5).map((m) => JSON.stringify(m)).join('\n---\n');
    assert.fail(`${mismatches.length} ${label} mismatch(es). First ones:\n${sample}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Table model: cell positions and spans against the rendered layout.
// ---------------------------------------------------------------------------

function randomTable(r) {
  const spanValue = (kind) =>
    r.chance(0.7)
      ? String(r.int(1, 3))
      : r.pick(kind === 'row' ? ['0', '-1', 'abc', ' 2', '2px', '+2', '1.5', '', '70000', '4'] : ['0', '-1', 'abc', ' 2', '3px', '+2', '1.9', '', '1001']);
  const cell = () => {
    const tag = r.chance(0.2) ? 'th' : 'td';
    let attrs = '';
    if (r.chance(0.35)) attrs += ` colspan="${spanValue('col')}"`;
    if (r.chance(0.35)) attrs += ` rowspan="${spanValue('row')}"`;
    const close = r.chance(0.7) ? `</${tag}>` : '';
    return `<${tag}${attrs}>x${close}`;
  };
  const row = () => {
    const n = r.int(0, 5);
    const cells = Array.from({ length: n }, cell).join('');
    if (r.chance(0.15)) return cells; // cells without <tr>: implied row (only valid at section start)
    return `<tr>${cells}${r.chance(0.7) ? '</tr>' : ''}`;
  };
  const sections = [];
  const count = r.int(1, 4);
  for (let s = 0; s < count; s++) {
    let kind = r.pick(['tbody', 'tbody', 'implied']);
    if (s === 0 && r.chance(0.3)) kind = 'thead';
    if (s === count - 1 && s > 0 && r.chance(0.3)) kind = 'tfoot';
    const rows = Array.from({ length: r.int(1, 5) }, row);
    // Make sure implied rows only appear first in their section.
    const body = rows.map((x, i) => (i > 0 && !x.startsWith('<tr>') ? `<tr>${x}` : x)).join('');
    if (kind === 'implied') sections.push(body);
    else sections.push(`<${kind}>${body}${r.chance(0.6) ? `</${kind}>` : ''}`);
  }
  return `<table>${r.chance(0.2) ? '<caption>cap</caption>' : ''}${sections.join('')}</table>`;
}

describe('table model vs Chromium layout', () => {
  it('places every cell exactly where Chromium renders it', async () => {
    for (let run = 0; run < RUNS; run++) {
      const r = rng(SEED + run);
      const cases = Array.from({ length: 1500 }, () => randomTable(r));
      const mismatches = await ctx.page.evaluate((cases) => {
        const sandbox = document.getElementById('sandbox');
        const out = [];
        for (const html of cases) {
          const ours = [];
          const parsed = window.gridclip.parseHTMLTable(html, {
            cell: (c) => void ours.push([c.tag, c.row, c.col, c.rowSpan, c.colSpan]),
          });
          sandbox.innerHTML = html;
          const table = sandbox.querySelector('table');
          const colgroup = document.createElement('colgroup');
          for (let i = 0; i < 5000; i++) colgroup.appendChild(document.createElement('col'));
          table.prepend(colgroup);
          table.style.width = "100000px";
          const t = table.getBoundingClientRect();
          const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
          const rowRects = rows.map((tr) => tr.getBoundingClientRect());
          const theirs = [];
          for (const [y, tr] of rows.entries()) {
            for (const td of tr.cells) {
              const rect = td.getBoundingClientRect();
              let last = y;
              for (let k = y; k < rows.length; k++) if (Math.abs(rowRects[k].bottom - rect.bottom) < 0.5) last = k;
              theirs.push([td.localName, y, Math.round((rect.left - t.left) / 20), last - y + 1, Math.round(rect.width / 20)]);
            }
          }
          const width = Math.max(0, ...theirs.map(([, , c, , cs]) => c + cs));
          const shapeOk = parsed.rows.length === rows.length && parsed.rows.every((row) => row.length === width);
          if (JSON.stringify(ours) !== JSON.stringify(theirs) || !shapeOk) out.push({ html, ours, theirs, shapeOk });
        }
        return out;
      }, cases);
      reportMismatches(mismatches, 'table model');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Tree building: which elements become rows and cells, on fuzzed markup.
// ---------------------------------------------------------------------------

const FUZZ_TOKENS = [
  '<table>', '</table>', '<tr>', '</tr>', '<td>', '</td>', '<th>', '</th>', '<tbody>', '</tbody>', '<thead>', '</thead>',
  '<tfoot>', '</tfoot>', '<caption>', '</caption>', '<colgroup>', '<col>', '<td colspan=2>', '<td rowspan="2">',
  '<th colspan=0>', '<td colspan=99999>', '<td colspan=" 3">', '<p>', '</p>', '<div>', '</div>', '<span>', '</span>', '<b>',
  '<br>', '</br>', '<pre>', '<style>', '</style>', '<title>', '</title>', '<textarea>', '</textarea>', '<!--', '-->', '<!',
  '<!-->', '<?', '</', '</ x>', '<', '>', '/>', '"', "'", '=', ' ', '\n', 'a', '&', '&amp;', '&lt;td&gt;', '<td title="a>b">',
  "<td title='</td>'>", '<td/>', '<tr/>', '<table/>', '<html>', '</body>', '<body>', '<xmp>', '</xmp>', '<TD>', '</TR>',
  '<td\n>', '<td a=b c d=\'e\'>', '<img>', '<input type=hidden>', '<form>', '</form>',
];

describe('tree building vs Chromium parser', () => {
  it('finds the same rows and cells in fuzzed markup', async () => {
    for (let run = 0; run < RUNS; run++) {
      const r = rng(SEED * 7 + run);
      const cases = Array.from({ length: 6000 }, () => {
        const n = r.int(1, 30);
        let html = r.chance(0.8) ? '<table>' : '';
        for (let i = 0; i < n; i++) html += r.pick(FUZZ_TOKENS);
        return html;
      });
      const mismatches = await ctx.page.evaluate((cases) => {
        const sandbox = document.getElementById('text-sandbox');
        const out = [];
        for (const html of cases) {
          const ours = [];
          const parsed = window.gridclip.parseHTMLTable(html, { cell: (c) => void ours.push([c.tag, c.row, c.colSpan]) });
          sandbox.innerHTML = html;
          const table = sandbox.querySelector('table');
          let theirs = null;
          if (table) {
            theirs = [];
            const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
            rows.forEach((tr, y) => {
              for (const td of tr.cells) theirs.push([td.localName, y, td.colSpan]);
            });
          }
          const same = parsed === null ? theirs === null : theirs !== null && JSON.stringify(ours) === JSON.stringify(theirs);
          if (!same) out.push({ html, ours: parsed && ours, theirs });
        }
        return out;
      }, cases);
      reportMismatches(mismatches, 'tree building');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Character references, in text and in attribute values.
// ---------------------------------------------------------------------------

describe('character references vs Chromium parser', () => {
  it('decodes text and attributes identically', async () => {
    const r = rng(SEED * 13 + RUNS);
    const alphabet = ['&', '&', '#', 'x', 'X', '1', '2', '8', '9', '0', 'a', 'F', ';', ';', 'amp', 'lt', 'gt', 'copy', 'not', 'notin',
      'nbsp', 'eacute', 'Eacute', 'quot', 'apos', 'AMP', 'hellip', 'thetasym', 'frac12', 'sup2', 'zwj', 'euro', 'unknown', '=', 'Z',
      '128', '150', '55296', '1114112', '0000065', 'x1F600', 'x110000', 'xD800', 'x9F', 'x0'];
    const cases = Array.from({ length: 6000 }, () => Array.from({ length: r.int(1, 8) }, () => r.pick(alphabet)).join(''));
    const mismatches = await ctx.page.evaluate((cases) => {
      const sandbox = document.getElementById('text-sandbox');
      const out = [];
      for (const s of cases) {
        let attr;
        const html = `<table><tr><td data-x="${s}" data-y=${s}>${s}</td></tr></table>`;
        const parsed = window.gridclip.parseHTMLTable(html, { preserveNbsp: true, cell: (c) => void (attr = c.attributes) });
        sandbox.innerHTML = html;
        const td = sandbox.querySelector('td');
        const theirs = [td.textContent, td.getAttribute('data-x'), td.getAttribute('data-y')];
        const ours = [parsed.rows[0][0], attr['data-x'], attr['data-y']];
        if (JSON.stringify(ours) !== JSON.stringify(theirs)) out.push({ s, ours, theirs });
      }
      return out;
    }, cases);
    reportMismatches(mismatches, 'character reference');
  });

  it('knows every named reference Chromium supports from the HTML 4 set', async () => {
    const mismatches = await ctx.page.evaluate(() => {
      // Every name gridclip knows must decode exactly like the browser does.
      const names = ['nbsp', 'iexcl', 'cent', 'pound', 'curren', 'yen', 'brvbar', 'sect', 'uml', 'copy', 'ordf', 'laquo', 'not', 'shy',
        'reg', 'macr', 'deg', 'plusmn', 'sup2', 'sup3', 'acute', 'micro', 'para', 'middot', 'cedil', 'sup1', 'ordm', 'raquo', 'frac14',
        'frac12', 'frac34', 'iquest', 'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil', 'Egrave', 'Eacute',
        'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml', 'ETH', 'Ntilde', 'Ograve', 'Oacute', 'Ocirc', 'Otilde', 'Ouml', 'times',
        'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute', 'THORN', 'szlig', 'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring',
        'aelig', 'ccedil', 'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml', 'eth', 'ntilde', 'ograve', 'oacute',
        'ocirc', 'otilde', 'ouml', 'divide', 'oslash', 'ugrave', 'uacute', 'ucirc', 'uuml', 'yacute', 'thorn', 'yuml', 'fnof', 'Alpha',
        'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
        'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
        'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigmaf', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi',
        'omega', 'thetasym', 'upsih', 'piv', 'bull', 'hellip', 'prime', 'Prime', 'oline', 'frasl', 'weierp', 'image', 'real', 'trade',
        'alefsym', 'larr', 'uarr', 'rarr', 'darr', 'harr', 'crarr', 'lArr', 'uArr', 'rArr', 'dArr', 'hArr', 'forall', 'part', 'exist',
        'empty', 'nabla', 'isin', 'notin', 'ni', 'prod', 'sum', 'minus', 'lowast', 'radic', 'prop', 'infin', 'ang', 'and', 'or', 'cap',
        'cup', 'int', 'there4', 'sim', 'cong', 'asymp', 'ne', 'equiv', 'le', 'ge', 'sub', 'sup', 'nsub', 'sube', 'supe', 'oplus',
        'otimes', 'perp', 'sdot', 'lceil', 'rceil', 'lfloor', 'rfloor', 'lang', 'rang', 'loz', 'spades', 'clubs', 'hearts', 'diams',
        'quot', 'amp', 'lt', 'gt', 'apos', 'OElig', 'oelig', 'Scaron', 'scaron', 'Yuml', 'circ', 'tilde', 'ensp', 'emsp', 'thinsp',
        'zwnj', 'zwj', 'lrm', 'rlm', 'ndash', 'mdash', 'lsquo', 'rsquo', 'sbquo', 'ldquo', 'rdquo', 'bdquo', 'dagger', 'Dagger',
        'permil', 'lsaquo', 'rsaquo', 'euro', 'AMP', 'COPY', 'GT', 'LT', 'QUOT', 'REG'];
      const sandbox = document.getElementById('text-sandbox');
      const out = [];
      for (const name of names) {
        for (const form of [`&${name};`, `&${name}`]) {
          const parsed = window.gridclip.parseHTMLTable(`<table><tr><td>${form}</td></tr></table>`, { preserveNbsp: true });
          sandbox.innerHTML = `<table><tr><td>${form}</td></tr></table>`;
          const theirs = sandbox.querySelector('td').textContent;
          if (parsed.rows[0][0] !== theirs) out.push({ form, ours: parsed.rows[0][0], theirs });
        }
      }
      return out;
    });
    reportMismatches(mismatches, 'named reference');
  });
});

// ---------------------------------------------------------------------------
// 4. Cell text against innerText, for content where both agree by design.
// ---------------------------------------------------------------------------

function randomContent(r, { strict }, depth = 0) {
  const texts = strict
    ? ['a', 'bc', ' ', '  ', ' x ', '\t', 'y z', '한', '&amp;', '&lt;', 'q&nbsp;r', '😀', 'a  b']
    : ['a', 'bc', ' ', '  ', '\n', ' x ', '\t', 'y\n z', '한', '&amp;', '&lt;', 'q&nbsp;r', '😀', '\n\n'];
  const modes = ['pre', 'pre-wrap', 'normal', 'pre-line', 'nowrap', 'break-spaces'];
  const parts = [];
  const n = r.int(1, 5);
  for (let i = 0; i < n; i++) {
    const inner = () => randomContent(r, { strict }, depth + 1);
    switch (r.int(0, depth > 2 ? 2 : strict ? 7 : 9)) {
      case 0:
      case 1:
      case 2:
        parts.push(r.pick(texts));
        break;
      case 3:
        parts.push(`<b>${inner()}</b>`);
        break;
      case 4:
        parts.push(`<span style="white-space:${r.pick(modes)}">${inner()}</span>`);
        break;
      case 5:
        parts.push(`<div>${inner()}</div>`);
        break;
      case 6:
        parts.push(`<span style="display:none">${inner()}</span>`);
        break;
      case 7:
        parts.push(`<i hidden>${inner()}</i>`);
        break;
      case 8:
        parts.push(`<pre>${inner()}</pre>`);
        break;
      case 9:
        parts.push('<br>');
        break;
    }
  }
  return parts.join('');
}

async function compareInnerText(cases, normalise) {
  return ctx.page.evaluate(
    ({ cases, normalise }) => {
      const sandbox = document.getElementById('text-sandbox');
      const norm = (s) => (normalise ? s.replace(/\n+/g, '\n').replace(/^\n|\n$/g, '') : s);
      const out = [];
      for (const inner of cases) {
        const html = `<table><tr><td>${inner}</td></tr></table>`;
        sandbox.innerHTML = html;
        const theirs = norm(sandbox.querySelector('td').innerText);
        const ours = norm(window.gridclip.parseHTMLTable(html, { preserveNbsp: true }).rows[0][0]);
        // Known divergence: when a line holds only preserved spaces and a
        // collapsed newline follows, Chromium sometimes keeps one more space
        // depending on unrelated earlier blocks (a LayoutNG detail no
        // clipboard content triggers). Tolerate that, and nothing else.
        const leading = (x) => x.replace(/^ +/gm, ' ');
        if (ours !== theirs && !(normalise && leading(ours) === leading(theirs))) out.push({ inner, ours, theirs });
      }
      return out;
    },
    { cases, normalise },
  );
}

describe('cell text vs innerText', () => {
  it('matches innerText exactly on inline content, blocks, white-space modes and hidden content', async () => {
    for (let run = 0; run < RUNS; run++) {
      const r = rng(SEED * 31 + run);
      const cases = Array.from({ length: 5000 }, () => randomContent(r, { strict: true }));
      reportMismatches(await compareInnerText(cases, false), 'innerText');
    }
  });

  it('produces the same lines as innerText with <br>, <pre> and preserved newlines', async () => {
    // innerText adds a line break where nothing renders (a final <br> or
    // newline before a block boundary); gridclip follows the rendered lines,
    // which is what makes `<td><br></td>` an empty cell. So compare the
    // sequence of non-empty lines only.
    for (let run = 0; run < RUNS; run++) {
      const r = rng(SEED * 37 + run);
      const cases = Array.from({ length: 5000 }, () => randomContent(r, { strict: false }));
      reportMismatches(await compareInnerText(cases, true), 'innerText (normalised)');
    }
  });
});
