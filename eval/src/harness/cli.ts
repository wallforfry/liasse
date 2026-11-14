import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createTextModel } from '@liasse/core/models';
import { compareReports, parseReport } from './compare.ts';
import { runEvaluation } from './run.ts';

// `pnpm eval:run --label <name> [--out <file>]`: one run with the models of the
// configuration (`.env` at the root, then the environment). It calls those models: run
// it on purpose, never from the tests or the CI.
const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    out: { type: 'string' },
  },
});

const label = values.label;
// pnpm runs the script in the package folder and keeps the folder it was called from.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out ?? `eval-${label}.json`);

const report = await runEvaluation({
  label,
  env: process.env,
  agentModel: (_ids, config) => createTextModel(config.llm),
});
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${compareReports([parseReport(report)])}\n\nReport written to ${out}\n`);
