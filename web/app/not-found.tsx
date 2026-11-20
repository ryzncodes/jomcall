// Shown for any address that does not exist, including the preview-only
// pages on the hosted site. The language is unknown here, so it says
// everything in English and Bahasa Melayu.
export default function NotFound() {
  return (
    <main className="not-found">
      <p className="not-found-code">404</p>
      <h1>We could not find that page.</h1>
      <p lang="ms">Kami tidak menemui halaman itu.</p>
      <p className="not-found-hint">
        The link may be old or typed wrong. / Pautan mungkin lama atau salah
        taip.
      </p>
      <a className="button button-dark" href="/">
        Back to JomCall / Kembali ke JomCall
      </a>
    </main>
  );
}
