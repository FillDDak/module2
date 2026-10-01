import type { Grid, MergeRange } from '../types';
import { describe } from '../util';
import { TextBuilder, type WhiteSpace } from './text';
import { tokenize, type Token } from './tokenizer';

export interface ParseHTMLTableOptions {
  /**
   * What to put in the slots covered by a merged cell (other than its
   * top-left slot). `'empty'` mirrors what spreadsheets do on paste;
   * `'repeat'` copies the merged cell's value into every slot it covers.
   * @default 'empty'
   */
  mergedCells?: 'empty' | 'repeat';
  /**
   * Keep U+00A0 NO-BREAK SPACE characters instead of turning them into
   * regular spaces. Excel and many web pages use `&nbsp;` purely for layout;
   * by default a line made only of no-break spaces (`<td>&nbsp;</td>`) is
   * read as empty.
   * @default false
   */
  preserveNbsp?: boolean;
  /**
   * Customise the value of every cell. Receives the cell's rendered text,
   * tag name, attributes and final position; return a string to use instead
   * of the text, or `undefined` to keep it. Useful for reading raw values
   * such as Excel's `x:num` attribute or `data-*` attributes.
   */
  cell?: (cell: HTMLTableCell) => string | undefined | null | void;
  /**
   * Upper bound for rows × columns of the resulting grid. Protects against
   * "paste bombs" such as a few bytes of `<td colspan=1000>` repeated.
   * Exceeding it throws a `RangeError`.
   * @default 5_000_000
   */
  maxCells?: number;
}

export interface HTMLTableCell {
  /** The cell's rendered text (after white-space processing). */
  text: string;
  /** `'td'` or `'th'`. */
  tag: 'td' | 'th';
  /**
   * The cell element's attributes, with lower-cased names and decoded values.
   * A prototype-less object, so attribute names such as `__proto__` are
   * harmless; use `name in attributes` or `Object.hasOwn()` to test for one.
   */
  attributes: Readonly<Record<string, string>>;
  row: number;
  col: number;
  /** Effective number of rows the cell covers. */
  rowSpan: number;
  /** Effective number of columns the cell covers. */
  colSpan: number;
}

export interface HTMLTable {
  /** The table's cells as a rectangular grid of strings. */
  rows: Grid;
  /** Cells spanning more than one slot, in document order. */
  merges: MergeRange[];
}

/** Result of scanning a document: the first table plus whether other content exists. */
export interface HTMLScan {
  table: HTMLTable | null;
  /** True when the document has visible text outside its first table. */
  hasOutsideText: boolean;
}

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'legend', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'ul', 'xmp',
  'plaintext', 'caption',
]);
const VOID = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'image', 'img', 'input', 'keygen',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** Elements whose content is never rendered as text. */
const INVISIBLE = new Set([
  'script', 'style', 'template', 'title', 'textarea', 'head', 'noscript', 'noembed', 'noframes', 'iframe',
  'select', 'datalist', 'object', 'svg', 'math', 'video', 'audio', 'canvas', 'map',
]);
const MAX_DEPTH = 64;
const preservesSpaces = (ws: WhiteSpace) => ws === 'preserve' || ws === 'preserve-wrap';
const PRE_DEFAULT: Record<string, WhiteSpace> = {
  pre: 'preserve', listing: 'preserve', xmp: 'preserve', plaintext: 'preserve', nobr: 'collapse',
};

interface StyleInfo {
  ws: WhiteSpace | undefined;
  /** Excel's `mso-spacerun: yes`, whose no-break spaces Excel reads back as plain spaces. */
  spacerun: boolean | undefined;
  hidden: boolean;
  ignoreColspan: boolean;
  ignoreRowspan: boolean;
}

function parseStyle(attrs: Record<string, string>): StyleInfo {
  const info: StyleInfo = { ws: undefined, spacerun: undefined, hidden: 'hidden' in attrs, ignoreColspan: false, ignoreRowspan: false };
  const style = attrs.style;
  if (!style) return info;
  for (const decl of style.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).replace(/!\s*important/i, '').trim().toLowerCase();
    switch (prop) {
      case 'white-space':
      case 'white-space-collapse': {
        if (value === 'pre' || value === 'preserve nowrap') info.ws = 'preserve';
        else if (value === 'pre-wrap' || value === 'break-spaces' || value === 'preserve' || value === 'preserve-spaces') info.ws = 'preserve-wrap';
        else if (value === 'pre-line' || value === 'preserve-breaks') info.ws = 'pre-line';
        else if (value === 'normal' || value === 'nowrap' || value === 'collapse') info.ws = 'collapse';
        break;
      }
      case 'mso-spacerun':
        info.spacerun = value === 'yes';
        if (info.spacerun) info.ws = 'preserve';
        break;
      case 'display':
        if (value === 'none') info.hidden = true;
        break;
      case 'mso-ignore':
        if (value.includes('colspan')) info.ignoreColspan = true;
        if (value.includes('rowspan')) info.ignoreRowspan = true;
        break;
    }
  }
  return info;
}

/** WHATWG "rules for parsing non-negative integers" (lenient: "2px" → 2). */
function parseSpan(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^[\t\n\f\r ]*([+-]?)(\d+)/.exec(value);
  if (!m) return undefined;
  const num = Number(m[2]);
  if (m[1] === '-' && num !== 0) return undefined;
  return num;
}

interface Cell {
  tag: 'td' | 'th';
  attrs: Record<string, string>;
  text: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  growing: boolean;
  ignoreColspan: boolean;
  ignoreRowspan: boolean;
}

interface OpenElement {
  name: string;
  ws: WhiteSpace;
  spacerun: boolean;
  hidden: boolean;
}

class TableBuilder {
  cells: Cell[] = [];
  /** Occupied slots of the current row. */
  private occupied: boolean[] = [];
  /** Cells of the current row group still spanning into rows not opened yet. */
  private spanning: Cell[] = [];
  rowCount = 0;
  width = 0;

  private sectionOpen = false;
  /** Tag of the open row group; rows outside any group get an implied tbody. */
  private sectionTag = '';
  private sectionCells: Cell[] = [];
  private rowOpen = false;
  private x = 0;

  // Current cell.
  private cell: Cell | null = null;
  private text: TextBuilder | null = null;
  private stack: OpenElement[] = [];
  private skipNewline = false;

  /**
   * A table nested inside the current cell (or inside the caption). It is
   * parsed with the very same rules and, when it ends, flattened into the
   * cell's text — or discarded when it is hidden or part of the caption.
   */
  child: TableBuilder | null = null;
  private childVisible = false;
  /** Set when this table ended because a sibling `<table>` started. */
  restartSibling = false;

  /** Invisible elements open inside the table but outside any cell. */
  private strayInvisible: string[] = [];

  constructor(
    private readonly maxCells: number,
    readonly parent: TableBuilder | null = null,
    private readonly depth = 0,
  ) {}

  inCaption = false;
  done = false;
  /** Visible text inside <table> but outside any cell (foster-parented content). */
  strayText = false;

  start(token: Extract<Token, { type: 'start' }>): void {
    const { name } = token;
    if (this.inCaption && name === 'table') {
      this.startChild();
      return;
    }
    switch (name) {
      case 'td':
      case 'th':
        this.closeCell();
        if (this.inCaption) this.inCaption = false;
        if (!this.rowOpen) this.openRow();
        this.openCell(name, token.attrs);
        return;
      case 'tr':
        this.closeRow();
        this.inCaption = false;
        this.openRow();
        return;
      case 'thead':
      case 'tbody':
      case 'tfoot':
        this.closeSection();
        this.inCaption = false;
        this.sectionOpen = true;
        this.sectionTag = name;
        return;
      case 'caption':
        this.closeSection();
        this.inCaption = true;
        return;
      case 'col':
      case 'colgroup':
        this.closeSection();
        return;
      case 'table':
        if (this.cell) {
          this.startChild();
          return;
        }
        // A <table> start tag directly inside a table ends that table (and,
        // for a nested table, starts a sibling one).
        this.finish();
        this.restartSibling = true;
        return;
    }
    if (this.cell) this.contentStart(token);
    else if (!VOID.has(name) && (INVISIBLE.has(name) || parseStyle(token.attrs).hidden)) this.strayInvisible.push(name);
  }

  end(name: string): void {
    // End tags only close elements that are actually open; `</th>` does not
    // close a <td>, and `</thead>` does not close a (possibly implied) <tbody>.
    switch (name) {
      case 'td':
      case 'th':
        if (this.cell && this.cell.tag === name) this.closeCell();
        return;
      case 'tr':
        this.closeRow();
        return;
      case 'thead':
      case 'tbody':
      case 'tfoot':
        if (this.sectionOpen && this.sectionTag === name) this.closeSection();
        return;
      case 'caption':
        this.inCaption = false;
        return;
      case 'table':
        this.finish();
        return;
      case 'body':
      case 'html':
        return;
    }
    if (this.cell) this.contentEnd(name);
    else {
      const k = this.strayInvisible.lastIndexOf(name);
      if (k !== -1) this.strayInvisible.length = k;
    }
  }

  textToken(value: string): void {
    if (this.cell) {
      if (this.isHidden()) return;
      let text = value;
      if (this.skipNewline) {
        this.skipNewline = false;
        if (text[0] === '\n') text = text.slice(1);
        else if (text.startsWith('\r\n')) text = text.slice(2);
        else if (text[0] === '\r') text = text.slice(1);
      }
      // Excel writes the spaces of an mso-spacerun as `&nbsp;` and turns them
      // back into plain spaces on paste (verified with Excel for Windows).
      if (this.stack[this.stack.length - 1]?.spacerun) text = text.replace(/ /g, ' ');
      if (text) this.text!.text(text, this.whiteSpace());
    } else if (!this.inCaption && this.strayInvisible.length === 0 && /[^\t\n\f\r \u00a0]/.test(value)) {
      this.strayText = true;
    }
  }

  // ---- in-cell content -------------------------------------------------

  private whiteSpace(): WhiteSpace {
    return this.stack.length ? this.stack[this.stack.length - 1]!.ws : 'collapse';
  }

  private isHidden(): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1]!.hidden;
  }

  private contentStart(token: Extract<Token, { type: 'start' }>): void {
    const { name } = token;
    this.skipNewline = false;
    const hiddenParent = this.isHidden();
    const style = parseStyle(token.attrs);
    if (name === 'br') {
      if (!hiddenParent && !style.hidden) this.text!.hardBreak(preservesSpaces(style.ws ?? this.whiteSpace()));
      return;
    }
    const hidden = hiddenParent || style.hidden || INVISIBLE.has(name);
    // Elements that are not rendered produce no line breaks either.
    if (BLOCK.has(name) && !hidden) this.text!.softBreak();
    if (VOID.has(name)) return;
    const spacerun = style.spacerun ?? (this.stack.length > 0 && this.stack[this.stack.length - 1]!.spacerun);
    this.stack.push({ name, ws: style.ws ?? PRE_DEFAULT[name] ?? this.whiteSpace(), spacerun, hidden });
    if (name === 'pre' || name === 'listing') this.skipNewline = true;
  }

  private contentEnd(name: string): void {
    if (name === 'br') {
      // `</br>` is treated as `<br>` by browsers.
      if (!this.isHidden()) this.text!.hardBreak(preservesSpaces(this.whiteSpace()));
      return;
    }
    let index = -1;
    for (let k = this.stack.length - 1; k >= 0; k--) {
      if (this.stack[k]!.name === name) {
        index = k;
        break;
      }
    }
    if (index === -1) {
      if (name === 'p' && !this.isHidden()) this.text!.softBreak();
      return;
    }
    const wasHidden = this.stack[index]!.hidden;
    this.stack.length = index;
    this.skipNewline = false;
    if (BLOCK.has(name) && !wasHidden) this.text!.softBreak();
  }

  startChild(): void {
    this.child = new TableBuilder(this.maxCells, this, this.depth + 1);
    // Pathologically deep nesting is parsed but not flattened, which keeps
    // the work linear (browsers stop nesting at 512 levels, too).
    this.childVisible = this.cell !== null && !this.isHidden() && this.depth < MAX_DEPTH;
    if (this.childVisible) this.text!.softBreak();
  }

  /** Ends the nested table and writes its cells into the current cell: cells separated by spaces, rows by line breaks. */
  flushChild(): void {
    const child = this.child!;
    this.child = null;
    child.finish();
    if (!this.childVisible) return;
    const text = this.text!;
    let row = -1;
    for (const cell of child.cells) {
      if (cell.row !== row) {
        text.softBreak();
        row = cell.row;
      }
      if (cell.text) {
        text.space();
        text.text(cell.text, 'preserve');
      }
    }
    text.softBreak();
  }

  // ---- table model -------------------------------------------------------

  private occupy(col: number, cols: number): void {
    for (let c = col; c < col + cols; c++) this.occupied[c] = true;
  }

  private checkSize(rows: number, width: number): void {
    if (rows * width > this.maxCells) {
      throw new RangeError(
        `gridclip: the table has more than ${this.maxCells} cells (${rows} rows × ${width} columns); raise the maxCells option to allow it`,
      );
    }
  }

  private openRow(): void {
    if (!this.sectionOpen) {
      this.sectionOpen = true;
      this.sectionTag = 'tbody';
    }
    this.rowOpen = true;
    this.x = 0;
    this.occupied = [];
    const y = this.rowCount;
    this.checkSize(y + 1, this.width);
    // Materialise cells spanning down into this row; rowspan="0" cells grow.
    let keep = 0;
    for (const cell of this.spanning) {
      if (cell.growing) {
        cell.rowSpan = y - cell.row + 1;
      } else if (cell.row + cell.rowSpan <= y) {
        continue;
      }
      this.occupy(cell.col, cell.colSpan);
      this.spanning[keep++] = cell;
    }
    this.spanning.length = keep;
  }

  private openCell(tag: 'td' | 'th', attrs: Record<string, string>): void {
    const y = this.rowCount;
    while (this.occupied[this.x] === true) this.x++;

    let colSpan = parseSpan(attrs.colspan) ?? 1;
    if (colSpan === 0) colSpan = 1;
    if (colSpan > 1000) colSpan = 1000;
    let rowSpan = parseSpan(attrs.rowspan) ?? 1;
    if (rowSpan > 65534) rowSpan = 65534;
    const growing = rowSpan === 0;
    if (growing) rowSpan = 1;

    const style = parseStyle(attrs);
    const cell: Cell = {
      tag,
      attrs,
      text: '',
      row: y,
      col: this.x,
      rowSpan,
      colSpan,
      growing,
      ignoreColspan: style.ignoreColspan,
      ignoreRowspan: style.ignoreRowspan,
    };
    this.occupy(this.x, colSpan);
    this.x += colSpan;
    if (this.x > this.width) {
      this.width = this.x;
      this.checkSize(y + 1, this.width);
    }

    this.cells.push(cell);
    this.sectionCells.push(cell);
    if (growing || rowSpan > 1) this.spanning.push(cell);

    this.cell = cell;
    this.text = new TextBuilder();
    this.stack = [{ name: tag, ws: style.ws ?? 'collapse', spacerun: style.spacerun ?? false, hidden: false }];
    this.skipNewline = false;
  }

  private closeCell(): void {
    if (this.child) this.flushChild();
    if (!this.cell) return;
    this.cell.text = this.text!.toString();
    this.cell = null;
    this.text = null;
    this.stack = [];
  }

  private closeRow(): void {
    this.closeCell();
    if (!this.rowOpen) return;
    this.rowOpen = false;
    this.rowCount++;
  }

  private closeSection(): void {
    this.closeRow();
    if (!this.sectionOpen) return;
    this.sectionOpen = false;
    // Browsers never let a cell span past the end of its row group.
    const end = this.rowCount;
    for (const cell of this.sectionCells) {
      if (cell.row + cell.rowSpan > end) cell.rowSpan = end - cell.row;
    }
    this.sectionCells = [];
    this.spanning = [];
  }

  finish(): void {
    if (this.done) return;
    this.closeSection();
    this.inCaption = false;
    this.done = true;
  }
}

/** Validates the options shared by the HTML parsing functions. @internal */
export function validateHTMLOptions(options: ParseHTMLTableOptions): { mergedCells: 'empty' | 'repeat'; maxCells: number } {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`gridclip: options must be an object, received ${describe(options)}`);
  }
  const mergedCells = options.mergedCells ?? 'empty';
  if (mergedCells !== 'empty' && mergedCells !== 'repeat') {
    throw new TypeError(`gridclip: mergedCells must be 'empty' or 'repeat', received ${describe(mergedCells)}`);
  }
  if (options.cell !== undefined && typeof options.cell !== 'function') {
    throw new TypeError(`gridclip: the cell option must be a function, received ${describe(options.cell)}`);
  }
  const maxCells = options.maxCells ?? 5_000_000;
  if (typeof maxCells !== 'number' || !(maxCells >= 0)) {
    throw new TypeError(`gridclip: maxCells must be a non-negative number, received ${describe(maxCells)}`);
  }
  return { mergedCells, maxCells };
}

/**
 * Scans an HTML document or fragment, extracting its first `<table>` and
 * reporting whether it contains visible text outside that table.
 * @internal
 */
export function scanHTML(html: string, options: ParseHTMLTableOptions = {}): HTMLScan {
  if (typeof html !== 'string') {
    throw new TypeError(`gridclip: expected an HTML string, received ${describe(html)}`);
  }
  const { mergedCells, maxCells } = validateHTMLOptions(options);

  let builder: TableBuilder | null = null;
  let hasOutsideText = false;
  // Outside the table we only track whether we are inside an invisible element.
  const invisible: string[] = [];

  // The innermost table currently receiving tokens.
  let active: TableBuilder | null = null;

  tokenize(html, (token) => {
    if (active) {
      let node: TableBuilder = active;
      if (token.type === 'start') node.start(token);
      else if (token.type === 'end') node.end(token.name);
      else node.textToken(token.text);
      for (;;) {
        if (node.child) {
          node = node.child;
        } else if (node.done && node.parent) {
          const parent: TableBuilder = node.parent;
          const sibling = node.restartSibling;
          parent.flushChild();
          node = parent;
          if (sibling) parent.startChild();
        } else break;
      }
      active = node.done ? null : node;
      return;
    }
    if (token.type === 'start') {
      if (token.name === 'table' && !builder && invisible.length === 0) {
        active = builder = new TableBuilder(maxCells);
        return;
      }
      if ((INVISIBLE.has(token.name) || parseStyle(token.attrs).hidden) && !VOID.has(token.name)) {
        invisible.push(token.name);
      }
    } else if (token.type === 'end') {
      const k = invisible.lastIndexOf(token.name);
      if (k !== -1) invisible.length = k;
    } else if (invisible.length === 0 && /[^\t\n\f\r \u00a0]/.test(token.text)) {
      hasOutsideText = true;
      if (builder) return false; // Nothing left to learn.
    }
    return;
  });

  const b = builder as TableBuilder | null;
  if (!b) return { table: null, hasOutsideText };
  // Input ended inside nested tables: close them from the inside out.
  for (let open = active as TableBuilder | null; open && open.parent; open = open.parent) {
    open.finish();
    open.parent.flushChild();
  }
  b.finish();
  if (b.strayText) hasOutsideText = true;
  return { table: assemble(b, mergedCells, options), hasOutsideText };
}

/**
 * Turns no-break spaces into spaces. Lines made only of (no-break) spaces —
 * `<td>&nbsp;</td>`, Word's `<o:p>&nbsp;</o:p>` — are layout, not content,
 * and become empty.
 */
function replaceNbsp(value: string): string {
  return value
    .split('\n')
    .map((line) => (/^[ \u00a0]*$/.test(line) && line.indexOf('\u00a0') !== -1 ? '' : line.replace(/\u00a0/g, ' ')))
    .join('\n');
}

function assemble(b: TableBuilder, mergedCells: 'empty' | 'repeat', options: ParseHTMLTableOptions): HTMLTable {
  const rows: Grid = [];
  for (let r = 0; r < b.rowCount; r++) rows.push(new Array<string>(b.width).fill(''));
  const merges: MergeRange[] = [];
  const preserveNbsp = options.preserveNbsp === true;

  for (const cell of b.cells) {
    let value = cell.text;
    if (!preserveNbsp && value.indexOf('\u00a0') !== -1) value = replaceNbsp(value);
    if (options.cell) {
      const custom = options.cell({
        text: value,
        tag: cell.tag,
        attributes: cell.attrs,
        row: cell.row,
        col: cell.col,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
      });
      if (custom !== undefined && custom !== null) value = String(custom);
    }
    rows[cell.row]![cell.col] = value;

    const rowSpan = cell.ignoreRowspan ? 1 : cell.rowSpan;
    const colSpan = cell.ignoreColspan ? 1 : cell.colSpan;
    if (rowSpan > 1 || colSpan > 1) {
      merges.push({ row: cell.row, col: cell.col, rowSpan, colSpan });
      if (mergedCells === 'repeat') {
        for (let r = cell.row; r < cell.row + rowSpan; r++) {
          for (let c = cell.col; c < cell.col + colSpan; c++) rows[r]![c] = value;
        }
      }
    }
  }
  return { rows, merges };
}

/**
 * Extracts the first `<table>` of an HTML document or fragment — such as the
 * `text/html` flavour Excel, Google Sheets, Numbers, LibreOffice, Word and
 * browsers put on the clipboard — as a grid of strings plus its merged cells.
 *
 * Runs anywhere (no DOM required) and implements the HTML table model:
 * implied `<tr>`/`<tbody>`, `colspan`/`rowspan` (including `rowspan="0"`),
 * spans clipped at row-group boundaries, nested tables and malformed markup.
 * Cell text follows CSS white-space rules (`<br>`, blocks, `<pre>`,
 * `white-space`, Excel's `mso-spacerun`) and skips hidden content.
 *
 * Returns `null` when the HTML contains no table.
 *
 * @example
 * parseHTMLTable('<table><tr><td colspan=2>a</td></tr><tr><td>b<td>c</table>')
 * // { rows: [['a', ''], ['b', 'c']], merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }] }
 */
export function parseHTMLTable(html: string, options: ParseHTMLTableOptions = {}): HTMLTable | null {
  return scanHTML(html, options).table;
}
