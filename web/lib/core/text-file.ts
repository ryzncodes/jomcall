export async function readKnowledgeText(file: Blob): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await file.arrayBuffer(),
  );
}
