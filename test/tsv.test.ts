import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseTSV, stringifyTSV } from '../src';

describe('parseTSV', () => {
  it.each<[string, string, string[][]]>([
    ['empty input', '', []],
    ['only a BOM', '\ufeff', []],
    ['a single cell', 'a', [['a']]],
    ['a single empty cell (Excel copies it as a line ending)', '\r\n', [['']]],
    ['a single empty cell, LF', '\n', [['']]],
    ['two empty cells', '\t', [['', '']]],
    ['one row', 'a\tb\tc', [['a', 'b', 'c']]],
    ['trailing tab', 'a\t', [['a', '']]],
    ['leading tab', '\ta', [['', 'a']]],
    ['CRLF rows', 'a\tb\r\nc\td', [['a', 'b'], ['c', 'd']]],
    ['LF rows', 'a\tb\nc\td', [['a', 'b'], ['c', 'd']]],
    ['CR rows (classic Mac)', 'a\tb\rc\td', [['a', 'b'], ['c', 'd']]],
    ['mixed line endings', 'a\rb\nc\r\nd', [['a'], ['b'], ['c'], ['d']]],
    ['one trailing line ending is dropped', 'a\tb\r\n', [['a', 'b']]],
    ['only one trailing line ending is dropped', 'a\r\n\r\n', [['a'], ['']]],
    ['empty rows in the middle', 'a\n\nb', [['a'], [''], ['b']]],
    ['leading BOM is stripped', '\ufeffa\tb', [['a', 'b']]],
    ['BOM elsewhere is kept', 'a\ufeff', [['a\ufeff']]],
    ['quoted multi-line cell', '"multi\nline"\tc', [['multi\nline', 'c']]],
    ['quoted CRLF inside a cell is normalised', '"a\r\nb"\t"c\rd"', [['a\nb', 'c\nd']]],
    ['doubled quotes', '"say ""hi"""', [['say "hi"']]],
    ['quoted empty cell', '""\ta', [['', 'a']]],
    ['quoted cell containing a tab', '"a\tb"\tc', [['a\tb', 'c']]],
    ['quote in the middle is literal', '5" ruler\t12" ruler', [['5" ruler', '12" ruler']]],
    ['quoted prefix followed by text is literal', '"Hi" she said', [['"Hi" she said']]],
    ['unterminated quote is literal', '"abc\tdef', [['"abc', 'def']]],
    ['unterminated quote spanning lines is literal', '"a\nb\tc', [['"a', ''], ['b', 'c']]],
    ['lone quote', '"', [['"']]],
    ['two quotes', '""', [['']]],
    ['three quotes', '"""', [['"""']]],
    ['four quotes', '""""', [['"']]],
    ['quoted cell at end of row', 'a\t"b\nc"\nd\te', [['a', 'b\nc'], ['d', 'e']]],
    ['quoted cell followed by CRLF', '"x"\r\n"y"', [['x'], ['y']]],
    ['invalid quoted cell across lines falls back', '"a\nb" c\td', [['"a', ''], ['b" c', 'd']]],
    ['unicode and emoji', '한글\t日本語\t👍🏽\t𝒳', [['한글', '日本語', '👍🏽', '𝒳']]],
    ['spaces are significant', '  a \t b ', [['  a ', ' b ']]],
  ])('%s', (_name, input, expected) => {
    expect(parseTSV(input)).toEqual(expected);
  });

  it('pads ragged rows by default', () => {
    expect(parseTSV('a\tb\tc\nd\ne\tf')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
      ['e', 'f', ''],
    ]);
  });

  it('keeps ragged rows with rectangular: false', () => {
    expect(parseTSV('a\tb\tc\nd', { rectangular: false })).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('can keep \\r inside quoted cells', () => {
    expect(parseTSV('"a\r\nb"', { normalizeNewlines: false })).toEqual([['a\r\nb']]);
  });

  it('parses CSV with a custom delimiter', () => {
    expect(parseTSV('a,"b,c",d\n"e ""f""",g,', { delimiter: ',' })).toEqual([
      ['a', 'b,c', 'd'],
      ['e "f"', 'g', ''],
    ]);
  });

  it('treats tabs as data when another delimiter is used', () => {
    expect(parseTSV('a\tb;c', { delimiter: ';' })).toEqual([['a\tb', 'c']]);
  });

  it.each([['', '\n', '\r', '"', 'ab', 1, null]])('rejects invalid delimiter %j', (delimiter) => {
    expect(() => parseTSV('a', { delimiter: delimiter as string })).toThrow(TypeError);
  });

  it('rejects non-string input', () => {
    expect(() => parseTSV(undefined as unknown as string)).toThrow(TypeError);
    expect(() => parseTSV(42 as unknown as string)).toThrow(/expects a string, received 42/);
  });

  it('does not treat a quote after the delimiter-less start as quoted', () => {
    expect(parseTSV('x"a\tb"')).toEqual([['x"a', 'b"']]);
  });

  it('is linear on pathological quote patterns', () => {
    const patterns = ['"a\t', '"\t', '"a"b\t', '""""x\t', '"\n', '"a""\t'];
    for (const pattern of patterns) {
      const input = pattern.repeat(40_000);
      const start = performance.now();
      const rows = parseTSV(input, { rectangular: false });
      const elapsed = performance.now() - start;
      expect(rows.length).toBeGreaterThan(0);
      expect(elapsed, `pattern ${JSON.stringify(pattern)}`).toBeLessThan(500);
    }
  });

  it('parses a large sheet quickly', () => {
    const row = Array.from({ length: 50 }, (_, i) => (i % 7 === 0 ? `"cell\n${i}"` : `cell ${i}`)).join('\t');
    const input = Array.from({ length: 4000 }, () => row).join('\r\n');
    const start = performance.now();
    const rows = parseTSV(input);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(rows).toHaveLength(4000);
    expect(rows[3999]).toHaveLength(50);
    expect(rows[0]![7]).toBe('cell\n7');
  });
});

describe('stringifyTSV', () => {
  it.each<[string, unknown[][], string]>([
    ['empty grid', [], ''],
    ['single cell', [['a']], 'a'],
    ['single empty cell keeps its row', [['']], '\n'],
    ['empty row keeps its row', [[]], '\n'],
    ['last row blank', [['a'], ['']], 'a\n\n'],
    ['two empty cells', [['', '']], '\t'],
    ['basic', [['a', 'b'], ['c', 'd']], 'a\tb\nc\td'],
    ['newline is quoted', [['a\nb']], '"a\nb"'],
    ['CR is quoted', [['a\rb']], '"a\rb"'],
    ['tab is quoted', [['a\tb']], '"a\tb"'],
    ['leading quote is quoted', [['"x"']], '"""x"""'],
    ['leading BOM is quoted so it survives parsing', [['\ufeffa']], '"\ufeffa"'],
    ['quote in the middle is not quoted', [['5" ruler']], '5" ruler'],
    ['quote and newline', [['say "hi"\nok']], '"say ""hi""\nok"'],
    ['null and undefined become empty', [[null, undefined, 'x']], '\t\tx'],
    ['numbers, booleans, bigint', [[1, 2.5, -0, true, 10n]], '1\t2.5\t0\ttrue\t10'],
    ['dates become ISO strings', [[new Date(Date.UTC(2024, 0, 2, 3, 4, 5))]], '2024-01-02T03:04:05.000Z'],
    ['invalid dates become empty', [[new Date(NaN), 'x']], '\tx'],
  ])('%s', (_name, grid, expected) => {
    expect(stringifyTSV(grid)).toBe(expected);
  });

  it('supports CRLF and a trailing newline', () => {
    expect(stringifyTSV([['a'], ['b']], { lineEnding: '\r\n', trailingNewline: true })).toBe('a\r\nb\r\n');
  });

  it('supports a custom delimiter', () => {
    expect(stringifyTSV([['a,b', 'c\td']], { delimiter: ',' })).toBe('"a,b",c\td');
  });

  it('validates its input', () => {
    expect(() => stringifyTSV('a' as unknown as string[][])).toThrow(TypeError);
    expect(() => stringifyTSV([['a'], 'b'] as unknown as string[][])).toThrow(/grid\[1\]/);
    expect(() => stringifyTSV([['a']], { lineEnding: '\r' as '\n' })).toThrow(TypeError);
    expect(() => stringifyTSV([['a']], { delimiter: '"' })).toThrow(TypeError);
  });

  it('accepts readonly grids', () => {
    const grid = Object.freeze([Object.freeze(['a', 'b'])] as const);
    expect(stringifyTSV(grid)).toBe('a\tb');
  });
});

const cellChars = fc.constantFrom('a', 'Z', ' ', '\t', '\n', '\r', '"', ',', ';', '한', '😀', '\u00a0', '\\', "'", '\ufeff');
const cell = fc.oneof(
  fc.string({ unit: cellChars, maxLength: 8 }),
  fc.string({ maxLength: 6 }),
  fc.string({ unit: 'grapheme', maxLength: 4 }),
  fc.string({ unit: 'binary', maxLength: 4 }),
);
const rectGrid = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }))
  .chain(([rows, cols]) => fc.array(fc.array(cell, { minLength: cols, maxLength: cols }), { minLength: rows, maxLength: rows }));

describe('TSV round-trip (property based)', () => {
  const normalise = (grid: string[][]) => grid.map((row) => row.map((c) => c.replace(/\r\n?/g, '\n')));

  for (const delimiter of ['\t', ',', ';', '|']) {
    for (const lineEnding of ['\n', '\r\n'] as const) {
      for (const trailingNewline of [false, true]) {
        it(`delimiter ${JSON.stringify(delimiter)}, lineEnding ${JSON.stringify(lineEnding)}, trailing ${trailingNewline}`, () => {
          fc.assert(
            fc.property(rectGrid, (grid) => {
              const text = stringifyTSV(grid, { delimiter, lineEnding, trailingNewline });
              expect(parseTSV(text, { delimiter })).toEqual(normalise(grid));
              expect(parseTSV(text, { delimiter, normalizeNewlines: false })).toEqual(grid);
            }),
            { numRuns: 300 },
          );
        });
      }
    }
  }

  it('never throws and always returns a rectangular grid for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', '"', '\t', '\n', '\r', ' '), maxLength: 60 }), (text) => {
        const rows = parseTSV(text);
        const width = rows[0]?.length ?? 0;
        for (const row of rows) expect(row).toHaveLength(width);
        // Re-serialising and parsing again is stable.
        expect(parseTSV(stringifyTSV(rows))).toEqual(rows.length === 0 ? [] : rows.map((r) => r.map((c) => c.replace(/\r\n?/g, '\n'))));
      }),
      { numRuns: 2000 },
    );
  });
});
