/**
 * TV shows from TVmaze (open, no key): where they're on, ratings, genres, the
 * next episode, posters kept as the chat's attachments. TVmaze lists TV, not
 * films. Only the search words leave the computer.
 */
import type { ShowEpisode, ShowItem } from '@conch/protocol';

import { httpsUrl, plain } from './pageData';
import { capturePictures } from './pictures';
import { getJson, numOf, OutsideError, rec, strOf, type OutsideDeps } from './outside';

/** Next episodes looked up, for the first shows still running. */
const NEXT_LOOKUPS = 3;

/** An address on TVmaze's API itself, or nothing: a show's links are followed nowhere else. */
function tvmazeApi(raw: unknown): string | undefined {
  const href =
    typeof raw === 'string' ? httpsUrl(raw.replace(/^http:\/\//i, 'https://')) : undefined;
  return href && new URL(href).hostname === 'api.tvmaze.com' ? href : undefined;
}

async function nextEpisode(
  deps: OutsideDeps,
  id: string,
  href: string,
  signal: AbortSignal,
): Promise<ShowEpisode | undefined> {
  try {
    const episode = rec(await getJson(deps, id, href, signal, 'TVmaze'));
    const at = strOf(episode.airstamp);
    if (!at || at.length > 40 || Number.isNaN(Date.parse(at))) return undefined;
    const season = numOf(episode.season);
    const number = numOf(episode.number);
    const name = plain(episode.name, 200);
    return {
      at,
      ...(season !== undefined && Number.isInteger(season) && season >= 0 && { season }),
      ...(number !== undefined && Number.isInteger(number) && number >= 0 && { number }),
      ...(name && { name }),
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

export async function searchShows(
  deps: OutsideDeps,
  conversationId: string,
  query: string,
  signal: AbortSignal,
): Promise<ShowItem[]> {
  const id = `shows-${conversationId}`;
  const body = await getJson(
    deps,
    id,
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
    signal,
    'TVmaze',
  );
  const found = (Array.isArray(body) ? body : []).map((r) => rec(rec(r).show)).slice(0, 6);
  const shows = found.flatMap((show) => {
    const title = plain(show.name, 300);
    const url = httpsUrl(strOf(show.url) ?? '');
    if (!title || !url) return [];
    const premiered = strOf(show.premiered);
    const year = premiered ? Number(premiered.slice(0, 4)) : undefined;
    const genres = (Array.isArray(show.genres) ? show.genres : [])
      .slice(0, 6)
      .flatMap((g) => plain(g, 60) ?? []);
    const rating = numOf(rec(show.rating).average);
    // TVmaze writes its summaries in HTML: only the words are kept.
    const summary = plain(show.summary, 600);
    const network = plain(rec(show.network).name ?? rec(show.webChannel).name, 120);
    const status = plain(show.status, 40);
    const image = rec(show.image);
    const item: ShowItem = {
      title,
      kind: 'tv',
      ...(year && Number.isInteger(year) && year >= 1800 && year <= 3000 && { year }),
      ...(genres.length && { genres }),
      ...(rating !== undefined && rating >= 0 && rating <= 10 && { rating }),
      ...(summary && { summary }),
      ...(network && { network }),
      ...(status && { status }),
      url,
    };
    return [
      {
        item,
        poster: strOf(image.original) ?? strOf(image.medium),
        next: status === 'Running' ? tvmazeApi(rec(rec(show._links).nextepisode).href) : undefined,
      },
    ];
  });
  if (!shows.length)
    throw new OutsideError(
      `TVmaze has no show called “${query}”. Try its original title, or web_search. For a film, use kind "movie".`,
    );
  let lookups = 0;
  const [posters, nexts] = await Promise.all([
    capturePictures(
      deps,
      conversationId,
      shows.map((s) => s.poster),
      signal,
      shows.map((s) => s.item.title),
    ),
    Promise.all(
      shows.map((s) =>
        s.next && lookups++ < NEXT_LOOKUPS
          ? nextEpisode(deps, id, s.next, signal)
          : Promise.resolve(undefined),
      ),
    ),
  ]);
  return shows.map((s, i) => ({
    ...s.item,
    ...(posters[i] && { poster: posters[i] }),
    ...(nexts[i] && { next: nexts[i] }),
  }));
}
