import { parseArgs } from 'node:util';
import { CORPUS_DIRECTORY } from '../corpus.ts';
import { buildCorpus } from './build-corpus.ts';
import { encodeHeicFiles, readHeicFiles } from './heic.ts';
import { writeCorpus } from './write-corpus.ts';

// pnpm --filter @liasse/eval generate [--encode-heic] [--out <directory>]
const { values } = parseArgs({
  options: {
    // Encode the HEIC files again instead of keeping the committed ones (macOS only).
    'encode-heic': { type: 'boolean', default: false },
    out: { type: 'string', default: CORPUS_DIRECTORY },
  },
});

const heic = values['encode-heic']
  ? await encodeHeicFiles()
  : await readHeicFiles(CORPUS_DIRECTORY);
const built = buildCorpus(heic);
await writeCorpus(values.out, built);

const bytes = built.files.reduce((total, file) => total + file.bytes.length, 0);
process.stdout.write(
  `Wrote ${String(built.files.length)} files (${String(bytes)} bytes) for ${String(built.corpus.documents.length)} documents and ${String(built.questions.questions.length)} questions to ${values.out}\n`,
);
