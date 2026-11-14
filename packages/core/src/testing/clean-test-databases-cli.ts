import {
  dropTestDatabases,
  LEAKED_MIN_AGE_SECONDS,
  leakedDatabases,
  listTestServerDatabases,
} from './clean-test-databases.ts';
import { withAdmin } from './test-server.ts';

const report = await withAdmin(async (sql) => {
  const listed = await listTestServerDatabases(sql);
  const leaked = leakedDatabases(listed);
  return { ...(await dropTestDatabases(sql, leaked)), active: listed.length - leaked.length };
});
process.stdout.write(
  `Dropped ${String(report.dropped.length)} test database(s). ` +
    `Kept ${String(report.kept.length + report.active)} in use or created less than ` +
    `${String(LEAKED_MIN_AGE_SECONDS / 60)} minutes ago.\n`,
);
