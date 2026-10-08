/**
 * Books from Open Library (the Internet Archive's open catalogue, no key):
 * titles, authors, the year, covers kept as the chat's attachments. Only the
 * search words leave the computer.
 */
import type { BookItem } from '@conch/protocol';

import { plain } from './pageData';
import { capturePictures } from './pictures';
import { getJson, numOf, OutsideError, rec, strOf, type OutsideDeps } from './outside';

/** A subject worth a chip: short, and not a catalogue code (`nyt:…`, `Fiction, general`). */
const goodSubject = (s: string) => s.length <= 32 && !/[:=]|, general$|^accessible/i.test(s);

export async function searchBooks(
  deps: OutsideDeps,
  conversationId: string,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<BookItem[]> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 12)));
  url.searchParams.set(
    'fields',
    'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,ratings_average,ratings_count',
  );
  const body = rec(
    await getJson(deps, `books-${conversationId}`, url.href, signal, 'Open Library'),
  );
  const docs = (Array.isArray(body.docs) ? body.docs : []).map(rec).slice(0, 12);
  const books = docs.flatMap((doc) => {
    const title = plain(doc.title, 300);
    const key = strOf(doc.key);
    if (!title || !key || !/^\/works\/OL\d+W$/.test(key)) return [];
    const authors = (Array.isArray(doc.author_name) ? doc.author_name : [])
      .slice(0, 6)
      .flatMap((a) => plain(a, 160) ?? []);
    const year = numOf(doc.first_publish_year);
    const pages = numOf(doc.number_of_pages_median);
    const rating = numOf(doc.ratings_average);
    const ratings = numOf(doc.ratings_count);
    const subjects = [
      ...new Set(
        (Array.isArray(doc.subject) ? doc.subject : [])
          .flatMap((s) => plain(s, 80) ?? [])
          .filter(goodSubject),
      ),
    ].slice(0, 4);
    const cover = numOf(doc.cover_i);
    const book: BookItem = {
      title,
      authors,
      ...(year !== undefined && Number.isInteger(year) && Math.abs(year) <= 3000 && { year }),
      ...(pages && Number.isInteger(pages) && pages > 0 && pages <= 100_000 && { pages }),
      ...(subjects.length && { subjects }),
      url: `https://openlibrary.org${key}`,
      ...(rating !== undefined &&
        rating >= 0 &&
        rating <= 5 && { rating: Math.round(rating * 100) / 100 }),
      ...(ratings !== undefined && Number.isInteger(ratings) && ratings >= 0 && { ratings }),
    };
    return [{ book, cover: cover && cover > 0 ? Math.trunc(cover) : undefined }];
  });
  if (!books.length)
    throw new OutsideError(
      `Open Library has no books for “${query}”. Try the title or the author’s name alone, or web_search.`,
    );
  const size = books.length <= 2 ? 'L' : 'M';
  const covers = await capturePictures(
    deps,
    conversationId,
    books.map((b) =>
      b.cover ? `https://covers.openlibrary.org/b/id/${b.cover}-${size}.jpg` : undefined,
    ),
    signal,
    books.map((b) => b.book.title),
  );
  return books.map((b, i) => ({ ...b.book, ...(covers[i] && { cover: covers[i] }) }));
}
