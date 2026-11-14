import type { Database } from '../db/client.ts';
import type { TextModel } from '../models/ports.ts';
import { findLinkCandidates, readLinkSource } from './link-candidates.ts';
import { proposeLinks } from './link-prompt.ts';
import { validateLinks } from './link-rules.ts';
import { replaceLinksBetween } from './link-store.ts';

export interface DetectLinksDeps {
  readonly db: Database;
  readonly textModel: TextModel;
}

export interface DetectedLinks {
  // Documents the text model was asked about. Zero means it was not called.
  readonly candidates: number;
  readonly proposed: number;
  readonly written: number;
}

const NOTHING: DetectedLinks = { candidates: 0, proposed: 0, written: 0 };

/**
 * Detects the links of a document: one call to the text model, about the candidates of
 * `findLinkCandidates`, and none when there is no candidate. The links kept replace
 * those the document had with each candidate, pair by pair, and the state of both
 * documents follows in the same transaction.
 *
 * It can be run again at any time, after a re-extraction for instance, and by two
 * workers at once. A document deleted while the model was asked gets no link. Links
 * with a document that is no longer a candidate are left as they are.
 */
export const detectLinks = async (
  { db, textModel }: DetectLinksDeps,
  documentId: string,
  signal?: AbortSignal,
): Promise<DetectedLinks> => {
  const source = await readLinkSource(db, documentId);
  // A document the text model would be shown nothing of cannot be judged.
  if (source === undefined || (source.title === null && source.summary === null)) return NOTHING;
  const candidates = await findLinkCandidates(db, source);
  if (candidates.length === 0) return NOTHING;
  const { links: proposed, model } = await proposeLinks(textModel, source, candidates, signal);
  const links = validateLinks(source, candidates, proposed);
  let written = 0;
  for (const candidate of candidates) {
    const outcome = await replaceLinksBetween(
      db,
      [source.id, candidate.id],
      links.filter(
        ({ fromDocumentId, toDocumentId }) =>
          fromDocumentId === candidate.id || toDocumentId === candidate.id,
      ),
      model,
    );
    if (outcome.written) written += outcome.links;
  }
  return { candidates: candidates.length, proposed: proposed.length, written };
};
