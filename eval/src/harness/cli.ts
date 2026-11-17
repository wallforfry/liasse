import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createTextModel } from '@liasse/core/models';
import { readSettingsFile } from '../settings-file.ts';
import { compareReports, parseReport } from './compare.ts';
import { runEvaluation } from './run.ts';

// `pnpm eval:run --settings <file> --label <name> [--out <file>]`: one run with the models
// of the settings file, in the shape of the settings the server stores (README.md). The
// database and the secrets come from `.env` at the root, then the environment. It calls
// those models: run it on purpose, never from the tests or the CI.
const { values } = parseArgs({
  options: {
    settings: { type: 'string' },
    label: { type: 'string', default: 'run' },
    out: { type: 'string' },
  },
});

if (values.settings === undefined) {
  process.stderr.write('Pass the JSON file of the model settings with --settings <file>.\n');
  process.exit(2);
}

// pnpm runs the script in the package folder and keeps the folder it was called from.
const calledFrom = process.env.INIT_CWD ?? process.cwd();
const label = values.label;
const out = resolve(calledFrom, values.out ?? `eval-${label}.json`);

const report = await runEvaluation({
  label,
  env: process.env,
  settings: await readSettingsFile(resolve(calledFrom, values.settings)),
  agentModel: (_ids, settings) => createTextModel(settings.llm),
});
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${compareReports([parseReport(report)])}\n\nReport written to ${out}\n`);
