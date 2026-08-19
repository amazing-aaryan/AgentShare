export type SearchIndexEntry = {
  source: string;
  kind: "file" | "conversation";
  text: string;
  startLine?: number;
  endLine?: number;
  sequence?: number;
  terms: Record<string, number>;
};

export type SearchIndex = {
  version: 1;
  entries: SearchIndexEntry[];
  documentFrequency: Record<string, number>;
};

export type EnvironmentSearchHit = {
  source: string;
  kind: "file" | "conversation";
  quote: string;
  score: number;
  startLine?: number;
  endLine?: number;
  sequence?: number;
};

export function buildSearchIndex(
  inputs: Array<
    | { kind: "file"; source: string; text: string }
    | { kind: "conversation"; source: string; text: string; sequence: number }
  >,
): SearchIndex {
  const entries: SearchIndexEntry[] = [];
  for (const input of inputs) {
    if (input.kind === "file") {
      const lines = input.text.split(/\r?\n/u);
      for (let offset = 0; offset < lines.length; offset += 40) {
        const text = lines
          .slice(offset, offset + 40)
          .join("\n")
          .trim();
        if (text.length === 0) continue;
        entries.push({
          source: input.source,
          kind: "file",
          text,
          startLine: offset + 1,
          endLine: Math.min(offset + 40, lines.length),
          terms: termCounts(text),
        });
      }
    } else {
      if (input.text.trim().length === 0) continue;
      entries.push({
        source: input.source,
        kind: "conversation",
        text: input.text,
        sequence: input.sequence,
        terms: termCounts(input.text),
      });
    }
  }

  const documentFrequency: Record<string, number> = {};
  for (const entry of entries) {
    for (const term of Object.keys(entry.terms)) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
    }
  }
  return { version: 1, entries, documentFrequency };
}

export function searchIndex(
  index: SearchIndex,
  query: string,
  limit = 8,
): EnvironmentSearchHit[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];
  const totalDocuments = Math.max(1, index.entries.length);
  return index.entries
    .map((entry) => {
      let score = 0;
      const documentLength = Object.values(entry.terms).reduce(
        (sum, count) => sum + count,
        0,
      );
      for (const term of queryTerms) {
        const frequency = entry.terms[term] ?? 0;
        if (frequency === 0) continue;
        const documentFrequency = index.documentFrequency[term] ?? 0;
        const inverse = Math.log(
          1 +
            (totalDocuments - documentFrequency + 0.5) /
              (documentFrequency + 0.5),
        );
        const normalized =
          (frequency * 2.2) /
          (frequency +
            1.2 * (0.25 + (0.75 * Math.max(1, documentLength)) / 120));
        score += inverse * normalized;
      }
      return { entry, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.source.localeCompare(right.entry.source, "en"),
    )
    .slice(0, limit)
    .map(({ entry, score }) => ({
      source: entry.source,
      kind: entry.kind,
      quote: entry.text.slice(0, 4_000),
      score,
      ...(entry.startLine === undefined ? {} : { startLine: entry.startLine }),
      ...(entry.endLine === undefined ? {} : { endLine: entry.endLine }),
      ...(entry.sequence === undefined ? {} : { sequence: entry.sequence }),
    }));
}

function termCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const term of tokenize(text)) counts[term] = (counts[term] ?? 0) + 1;
  return counts;
}

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("en-US")
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}_-]+/gu)
    .filter((term) => term.length > 1);
}
