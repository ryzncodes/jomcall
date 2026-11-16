import { cleanFileName } from "../../../contracts/src/setup-upload.ts";

// The two facts about a customer's media message that leave the database:
// its kind and, when there is one, the file name. Shared by the inbox read
// and the PDPA contact export so both say the same thing. The provider's
// media id, hash and file type are never selected. Rows stored before the
// webhook parser kept the kind fall back to the file type's family.
// The file name is customer-supplied: pass the selected facts through
// cleanMediaFacts, which also cleans names stored before the webhook parser
// did.
export const mediaFactsSql = (m: string) =>
  `case when ${m}.kind='media' then jsonb_strip_nulls(jsonb_build_object(
    'kind',case when ${m}.media->>'kind' in('image','audio','video','document','sticker') then ${m}.media->>'kind'
      when ${m}.media->>'mimeType' like 'image/%' then 'image'
      when ${m}.media->>'mimeType' like 'audio/%' then 'audio'
      when ${m}.media->>'mimeType' like 'video/%' then 'video'
      else 'document' end,
    'filename',nullif(left(${m}.media->>'filename',200),''))) end`;

// Removes control and bidirectional characters from a media fact's file
// name (see cleanFileName); a name left empty is dropped.
export function cleanMediaFacts<T extends { filename?: unknown } | null>(
  media: T,
): T {
  if (!media || typeof media.filename !== "string") return media;
  const { filename, ...rest } = media;
  const clean = cleanFileName(filename);
  return (clean === undefined ? rest : { ...rest, filename: clean }) as T;
}
