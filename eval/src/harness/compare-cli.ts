import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compareReports, parseReport } from './compare.ts';

// `pnpm eval:compare <report> <report> ...`: the reports of `pnpm eval:run`, one column
// each, as Markdown on the standard output.
const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length === 0) {
  process.stderr.write('Usage: pnpm eval:compare <report.json> [<report.json> ...]\n');
  process.exit(2);
}

const base = process.env.INIT_CWD ?? process.cwd();
const reports = await Promise.all(
  positionals.map(async (path) => {
    const parsed: unknown = JSON.parse(await readFile(resolve(base, path), 'utf8'));
    return parseReport(parsed);
  }),
);
process.stdout.write(`${compareReports(reports)}\n`);
