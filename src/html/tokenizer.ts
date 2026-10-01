import { decodeEntities } from './decode';

export type Token =
  | { type: 'text'; text: string }
  | { type: 'start'; name: string; attrs: Record<string, string> }
  | { type: 'end'; name: string };

/** Elements whose content is raw text that is never parsed as markup. */
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
/** Elements whose content is text with character references but no markup. */
const RCDATA = new Set(['title', 'textarea']);

const ENDIF = /<!\[endif\]>/gi;

const isAsciiAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * A small, forgiving, linear-time HTML tokenizer that follows the WHATWG
 * tokenization rules closely enough for clipboard fragments: comments,
 * bogus comments (`<!…>`, `<?…>`, conditional comments), raw text and
 * RCDATA elements, quoted/unquoted attributes and character references.
 * Calls `emit` for each token; if `emit` returns `false` tokenizing stops.
 */
export function tokenize(html: string, emit: (token: Token) => boolean | void): void {
  const n = html.length;
  let i = 0;
  let textStart = 0;

  const flushText = (end: number): boolean => {
    if (end > textStart) {
      return emit({ type: 'text', text: decodeEntities(html.slice(textStart, end)) }) !== false;
    }
    return true;
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const next = html.charCodeAt(lt + 1);

    // Comments and bogus comments.
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      if (!flushText(lt)) return;
      let end: number;
      if (next === 33 && html.startsWith('--', lt + 2)) {
        // `<!-->` and `<!--->` are complete (empty) comments.
        if (html.charCodeAt(lt + 4) === 62) end = lt + 5;
        else if (html.startsWith('->', lt + 4)) end = lt + 6;
        else {
          const close = html.indexOf('-->', lt + 4);
          end = close === -1 ? n : close + 3;
        }
      } else {
        const close = html.indexOf('>', lt + 2);
        end = close === -1 ? n : close + 1;
        // Office "downlevel-revealed" conditionals: `<![if !supportLists]>…<![endif]>`
        // is fallback content meant for non-Office readers and is kept, while
        // `<![if supportMisalignedColumns]>…<![endif]>` is for Office only and
        // is skipped (Excel uses it for an invisible phantom row).
        const cond = /^<!\[if\s+([^\]]*)\]>$/i.exec(html.slice(lt, end));
        if (cond && cond[1]!.trim()[0] !== '!') {
          ENDIF.lastIndex = end;
          end = ENDIF.exec(html) ? ENDIF.lastIndex : n;
        }
      }
      i = textStart = end;
      continue;
    }

    // End tags.
    if (next === 47 /* / */) {
      const c = html.charCodeAt(lt + 2);
      if (isAsciiAlpha(c)) {
        if (!flushText(lt)) return;
        const tag = readTag(html, lt + 2);
        if (!tag) {
          textStart = i = n; // EOF inside a tag: the tag is dropped.
          break;
        }
        if (emit({ type: 'end', name: tag.name }) === false) return;
        i = textStart = tag.end;
        continue;
      }
      if (c === 62 /* > */) {
        // `</>` is ignored entirely.
        if (!flushText(lt)) return;
        i = textStart = lt + 3;
        continue;
      }
      if (lt + 2 < n) {
        // `</ …>` is a bogus comment.
        if (!flushText(lt)) return;
        const close = html.indexOf('>', lt + 2);
        i = textStart = close === -1 ? n : close + 1;
        continue;
      }
      i = lt + 1;
      continue;
    }

    // Start tags.
    if (isAsciiAlpha(next)) {
      if (!flushText(lt)) return;
      const tag = readTag(html, lt + 1);
      if (!tag) {
        textStart = i = n;
        break;
      }
      if (emit({ type: 'start', name: tag.name, attrs: tag.attrs }) === false) return;
      i = textStart = tag.end;

      if (tag.name === 'plaintext') {
        if (n > i) emit({ type: 'text', text: html.slice(i) });
        return;
      }
      const raw = RAW_TEXT.has(tag.name);
      if (raw || RCDATA.has(tag.name)) {
        const close = findRawTextEnd(html, i, tag.name);
        const content = html.slice(i, close);
        if (content && emit({ type: 'text', text: raw ? content : decodeEntities(content) }) === false) return;
        i = textStart = close;
      }
      continue;
    }

    // A lone '<' is literal text.
    i = lt + 1;
  }
  flushText(n);
}

interface ParsedTag {
  name: string;
  attrs: Record<string, string>;
  end: number;
}

/** Reads a tag starting at its name. Returns null when the input ends inside the tag. */
function readTag(html: string, start: number): ParsedTag | null {
  const n = html.length;
  let i = start;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (isSpace(c) || c === 47 || c === 62) break;
    i++;
  }
  const name = html.slice(start, i).toLowerCase();
  const attrs: Record<string, string> = Object.create(null);

  for (;;) {
    while (i < n && isSpace(html.charCodeAt(i))) i++;
    if (i >= n) return null;
    let c = html.charCodeAt(i);
    if (c === 62) return { name, attrs, end: i + 1 };
    if (c === 47) {
      // A self-closing flag means nothing on HTML elements.
      i++;
      continue;
    }
    // Attribute name; a leading '=' is part of the name.
    const nameStart = i;
    i++;
    while (i < n) {
      c = html.charCodeAt(i);
      if (isSpace(c) || c === 47 || c === 62 || c === 61) break;
      i++;
    }
    const attrName = html.slice(nameStart, i).toLowerCase();
    let value = '';
    let j = i;
    while (j < n && isSpace(html.charCodeAt(j))) j++;
    if (html.charCodeAt(j) === 61 /* = */) {
      j++;
      while (j < n && isSpace(html.charCodeAt(j))) j++;
      const q = html.charCodeAt(j);
      if (q === 34 || q === 39) {
        const close = html.indexOf(q === 34 ? '"' : "'", j + 1);
        if (close === -1) return null;
        value = html.slice(j + 1, close);
        i = close + 1;
      } else {
        const vs = j;
        while (j < n) {
          c = html.charCodeAt(j);
          if (isSpace(c) || c === 62) break;
          j++;
        }
        value = html.slice(vs, j);
        i = j;
      }
      value = decodeEntities(value, true);
    }
    // The first occurrence of an attribute wins.
    if (!(attrName in attrs)) attrs[attrName] = value;
  }
}

function findRawTextEnd(html: string, from: number, name: string): number {
  let i = from;
  for (;;) {
    const k = html.indexOf('</', i);
    if (k === -1) return html.length;
    const after = k + 2 + name.length;
    if (html.slice(k + 2, after).toLowerCase() === name) {
      const c = html.charCodeAt(after);
      if (Number.isNaN(c) || isSpace(c) || c === 47 || c === 62) return k;
    }
    i = k + 2;
  }
}
