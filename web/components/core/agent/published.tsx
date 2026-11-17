"use client";
import { useCore, useWords, useResource, Loading } from "../state";
// What staff see: the published name, greeting and version number.
export function PublishedAgent({ id }: { id: string }) {
  const { workspace, client } = useCore(),
    r = useResource(
      () => client.execute("version", { agentId: workspace.agent.id, id }),
      id,
    ),
    w = useWords();
  return r.data ? (
    <section className="core-panel">
      <h2>{r.data.snapshot.settings.name}</h2>
      <p>{r.data.snapshot.settings.greeting}</p>
      <p>
        {w("Published configuration", "Konfigurasi diterbitkan")} #
        {r.data.sequence}
      </p>
    </section>
  ) : (
    <Loading error={r.error} />
  );
}
