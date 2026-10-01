/**
 * White-space handling of a text run: `collapse` (normal, nowrap),
 * `preserve` (pre), `preserve-wrap` (pre-wrap, break-spaces), `pre-line`.
 */
export type WhiteSpace = 'collapse' | 'preserve' | 'preserve-wrap' | 'pre-line';

/**
 * Builds the text of a cell from a stream of inline text, hard breaks
 * (`<br>`) and soft breaks (block boundaries), following CSS white-space
 * processing and the rendered line structure:
 *
 * - collapsible whitespace collapses to one space and disappears at the
 *   start and end of every line;
 * - a collapsed segment break (newline) also disappears next to a zero
 *   width space, or on a line holding only wrappable preserved spaces;
 * - a soft break only starts a new line between two pieces of content, and
 *   consecutive soft breaks collapse into one;
 * - a hard break always starts a new line, except a final one, which (like
 *   in a browser) does not produce an empty last line.
 *
 * The result matches Chromium's `innerText` line for line (verified by the
 * differential browser tests).
 */
export class TextBuilder {
  private lines: string[] = [];
  private cur = '';
  private lineHasContent = false;
  /** The current line holds nothing but preserved spaces of a wrapping (pre-wrap) run. */
  private lineOnlyWrapSpaces = false;
  private pendingSpace = false;
  /** The pending collapsed space contains a segment break. */
  private pendingSegmentBreak = false;
  private pendingSoft = false;
  private endsWithBreak = false;

  text(value: string, ws: WhiteSpace): void {
    if (ws === 'collapse') {
      this.collapsible(value);
      return;
    }
    const parts = value.split(/\r\n|\r|\n/);
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) this.hardBreak(ws !== 'pre-line');
      const part = parts[p]!;
      if (ws !== 'pre-line') {
        if (part) this.chars(part, ws === 'preserve-wrap' && /^ +$/.test(part));
      } else {
        this.collapsible(part);
      }
    }
  }

  /** A collapsible space, e.g. the separator between nested-table cells. */
  space(segmentBreak = false): void {
    if (!this.lineHasContent) return;
    if (segmentBreak && (this.lineOnlyWrapSpaces || this.cur.endsWith('\u200b'))) return;
    this.pendingSpace = true;
    if (segmentBreak) this.pendingSegmentBreak = true;
  }

  /**
   * Forced line break. A collapsible space right before it is normally
   * removed, but kept when the break itself is in a space-preserving
   * context (`<br>` or a newline inside `white-space: pre-wrap`), as browsers do.
   */
  hardBreak(keepSpace = false): void {
    if (this.pendingSoft) this.newline();
    if (keepSpace && this.pendingSpace) this.cur += ' ';
    this.newline();
    this.endsWithBreak = true;
  }

  softBreak(): void {
    if (this.lineHasContent) this.pendingSoft = true;
  }

  toString(): string {
    // A final line break does not start a new (empty) line when rendered, which
    // is also why LibreOffice writes empty cells as `<td><br></td>`.
    if (this.endsWithBreak) return this.lines.join('\n');
    return this.lines.length ? this.lines.join('\n') + '\n' + this.cur : this.cur;
  }

  private collapsible(value: string): void {
    const re = /[ \t\n\r\f]+/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      if (m.index > last) this.chars(value.slice(last, m.index), false);
      this.space(/[\n\r]/.test(m[0]));
      last = m.index + m[0].length;
    }
    if (last < value.length) this.chars(value.slice(last), false);
  }

  private chars(value: string, wrapSpacesOnly: boolean): void {
    if (this.pendingSoft) this.newline();
    if (this.pendingSpace && !(this.pendingSegmentBreak && value.startsWith('\u200b'))) this.cur += ' ';
    this.pendingSpace = false;
    this.pendingSegmentBreak = false;
    this.cur += value;
    this.lineOnlyWrapSpaces = this.lineHasContent ? this.lineOnlyWrapSpaces && wrapSpacesOnly : wrapSpacesOnly;
    this.lineHasContent = true;
    this.endsWithBreak = false;
  }

  private newline(): void {
    this.lines.push(this.cur);
    this.cur = '';
    this.lineHasContent = false;
    this.lineOnlyWrapSpaces = false;
    this.pendingSpace = false;
    this.pendingSegmentBreak = false;
    this.pendingSoft = false;
  }
}
