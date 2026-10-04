/**
 * How a page reads in a tool result, shared by the browser (which writes it)
 * and the model APIs' transcript (which folds stale copies away, ADR 0055).
 * Plain strings with no imports, so the engines don't load the browser.
 */

/** A whole page: what the browser sees, from the top. */
export const PAGE_OPEN = '<page-content>';
export const PAGE_CLOSE = '</page-content>';

/** What changed on the page since the agent last read it. */
export const CHANGES_OPEN = '<page-changes>';
export const CHANGES_CLOSE = '</page-changes>';

/** The first lines of either: `Page: <title>` and `Address: <url>`. */
export const PAGE_LINE = 'Page: ';
export const ADDRESS_LINE = 'Address: ';
