// Next's metadata types, imported from their own module rather than from
// "next". Importing "next" loads Next's global types, which make
// `process.env.NODE_ENV` read-only; the root typecheck (tests, engine) reaches
// these files through the public-site tests and must keep NODE_ENV writable.
export type { Metadata, MetadataRoute } from "next/dist/lib/metadata/types/metadata-interface.js";
