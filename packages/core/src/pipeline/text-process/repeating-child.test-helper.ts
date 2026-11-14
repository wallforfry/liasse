import { writeSync } from 'node:fs';
import { VERDICT_FD } from './verdict.ts';

// A child whose watchdog had the time to sample twice before its signal landed, and
// that died just as the server wrote to it.
writeSync(VERDICT_FD, 'cpu');
writeSync(VERDICT_FD, 'cpu');
process.send?.({ type: 'ready' }, () => {
  process.kill(process.pid, 'SIGKILL');
});
