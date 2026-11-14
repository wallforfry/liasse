import { withEntityLock } from '../entities/entity-lock.ts';

/**
 * Every write to `subjects`, and every write of a subject id elsewhere
 * (`documents.subject_ids`, `facts.subject_ids`, a `merge_subject` proposal), runs under
 * this lock, taken before the row of any document, and reads the subjects again under it:
 * an id that a merge removed meanwhile (`missingSubjectIds`) is never written.
 *
 * It is the lock of the entities, on purpose. The transaction that stores an extraction
 * writes entity ids and subject ids together and takes that lock before the row of the
 * document. A lock of their own would need a place in that order: taken after the row,
 * it would deadlock with a merge of subjects, which goes from the lock to the rows of the
 * documents it rewrites. One lock gives one rule, and both registries are written a few
 * times per document, so serializing them together costs little.
 */
export const withSubjectLock = withEntityLock;
