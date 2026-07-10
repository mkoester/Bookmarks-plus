import fuzzysort from "fuzzysort";

export interface TagCount {
  tag: string;
  count: number;
}

export interface TagSuggestion extends TagCount {
  /**
   * Positions in `tag` that the query fuzzy-matched, ascending. Empty for the
   * top-by-count fallback (no query to match against).
   */
  matchedIndexes: readonly number[];
}

const DEFAULT_LIMIT = 8;

/**
 * Rank tag suggestions for the folder editor's Tag autocomplete.
 *
 * Thin wrapper over fuzzysort so the widget stays library-agnostic and the
 * ranking is unit-testable (fuzzysort is pure JS — no DOM/ext). Free-text is a
 * concern of the caller; this only ranks *existing* tags.
 *
 * - Empty/whitespace query → the top `limit` tags by count (discoverability when
 *   the field is focused but empty); fuzzysort isn't consulted, so no matched
 *   indexes.
 * - Otherwise fuzzysort's fuzzy match, best score first, with a count desc (then
 *   alphabetical) tie-break on equal scores. fuzzysort does NOT preserve input
 *   order on ties, so the tie-break is applied here explicitly. Each result keeps
 *   the matched character positions (`matchedIndexes`) so the caller can highlight
 *   which part(s) of the tag matched.
 */
export function fuzzyFilterTags(
  query: string,
  candidates: TagCount[],
  limit: number = DEFAULT_LIMIT
): TagSuggestion[] {
  if (query.trim() === "") {
    return [...candidates]
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit)
      .map((c) => ({ ...c, matchedIndexes: [] }));
  }

  // fuzzysort scores higher-is-better and returns matches only.
  const results = fuzzysort.go(query, candidates, { key: "tag" });
  return [...results]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.obj.count - a.obj.count ||
        a.obj.tag.localeCompare(b.obj.tag)
    )
    .slice(0, limit)
    .map((r) => ({ ...r.obj, matchedIndexes: r.indexes }));
}

export interface HighlightRun {
  text: string;
  matched: boolean;
}

/**
 * Split `text` into consecutive matched/unmatched runs given the matched
 * character positions (as returned in `TagSuggestion.matchedIndexes`). Pure, so
 * the DOM widget can render each run and the merging stays unit-testable.
 * Out-of-range indexes are ignored.
 */
export function highlightRuns(
  text: string,
  matchedIndexes: readonly number[]
): HighlightRun[] {
  const matched = new Set(matchedIndexes);
  const runs: HighlightRun[] = [];
  for (let i = 0; i < text.length; i++) {
    const isMatch = matched.has(i);
    const last = runs[runs.length - 1];
    if (last && last.matched === isMatch) {
      last.text += text[i];
    } else {
      runs.push({ text: text[i], matched: isMatch });
    }
  }
  return runs;
}
