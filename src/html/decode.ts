import { LEGACY_ENTITIES, NAMED_ENTITIES } from './entities';

const hasOwn = Object.prototype.hasOwnProperty;

// https://html.spec.whatwg.org/#numeric-character-reference-end-state
const C1_REPLACEMENTS: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function codePointToString(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
  if (hasOwn.call(C1_REPLACEMENTS, code)) return String.fromCharCode(C1_REPLACEMENTS[code]!);
  return String.fromCodePoint(code);
}

const isAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

/**
 * Decodes HTML character references the way the HTML tokenizer does.
 * `inAttribute` enables the attribute-value rule for semicolon-less legacy
 * references (`&copy=1` stays literal inside attributes).
 */
export function decodeEntities(input: string, inAttribute = false): string {
  let amp = input.indexOf('&');
  if (amp === -1) return input;

  let out = '';
  let last = 0;
  const n = input.length;

  while (amp !== -1) {
    out += input.slice(last, amp);
    let i = amp + 1;
    let replacement: string | undefined;
    let end = amp + 1;

    if (input.charCodeAt(i) === 35 /* # */) {
      i++;
      const hex = input.charCodeAt(i) === 120 || input.charCodeAt(i) === 88; // x X
      if (hex) i++;
      const start = i;
      let code = 0;
      while (i < n && (hex ? isHex(input.charCodeAt(i)) : isDigit(input.charCodeAt(i)))) {
        if (code <= 0x10ffff) code = code * (hex ? 16 : 10) + parseInt(input[i]!, 16);
        i++;
      }
      if (i > start) {
        if (input.charCodeAt(i) === 59 /* ; */) i++;
        replacement = codePointToString(code);
        end = i;
      }
    } else {
      const start = i;
      while (i < n && isAlnum(input.charCodeAt(i))) i++;
      if (i > start) {
        const name = input.slice(start, i);
        if (input.charCodeAt(i) === 59 && hasOwn.call(NAMED_ENTITIES, name)) {
          replacement = NAMED_ENTITIES[name];
          end = i + 1;
        } else {
          // Longest legacy (semicolon-less) prefix, e.g. "&notit;" → "¬it;".
          for (let len = Math.min(name.length, 6); len >= 2; len--) {
            const prefix = name.slice(0, len);
            if (LEGACY_ENTITIES.has(prefix)) {
              const next = input.charCodeAt(start + len);
              if (inAttribute && (isAlnum(next) || next === 61 /* = */)) break;
              replacement = NAMED_ENTITIES[prefix];
              end = start + len;
              break;
            }
          }
        }
      }
    }

    if (replacement === undefined) {
      out += '&';
      last = amp + 1;
    } else {
      out += replacement;
      last = end;
    }
    amp = input.indexOf('&', last);
  }
  return out + input.slice(last);
}
