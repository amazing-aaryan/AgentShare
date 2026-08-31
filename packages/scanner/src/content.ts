export type ResourceContent =
  | { kind: "text"; mediaType: string; text: string }
  | { kind: "binary"; mediaType: string };

/** MIME parameters do not change the underlying content type. */
export function normalizeMediaType(mediaType: string): string {
  return (mediaType.split(";", 1)[0] ?? "").trim().toLowerCase();
}

export function isTextMediaType(mediaType: string): boolean {
  const normalized = normalizeMediaType(mediaType);
  return (
    normalized.startsWith("text/") ||
    /^application\/(?:json|(?:x-)?yaml|(?:x-)?toml|(?:[^;\s/]+\+json))$/u.test(
      normalized,
    )
  );
}

/** Only decode lossless UTF-8. Keep the BOM as a character for byte round trips. */
export function classifyResourceContent(
  mediaType: string,
  bytes: Uint8Array,
): ResourceContent {
  const binary: ResourceContent = {
    kind: "binary",
    mediaType: normalizeMediaType(mediaType),
  };
  if (!isTextMediaType(mediaType) || bytes.includes(0)) return binary;
  const charsets = mediaType.matchAll(
    /;\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/giu,
  );
  for (const match of charsets) {
    const charset = (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase();
    if (!/^(?:utf-?8|us-ascii)$/u.test(charset)) return binary;
    if (charset === "us-ascii" && bytes.some((byte) => byte > 127)) {
      return binary;
    }
  }
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return { kind: "text", mediaType: binary.mediaType, text };
  } catch {
    return binary;
  }
}
