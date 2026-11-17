// The web tests answer every request from a fake server at once, so none of them waits on
// anything but the CPU: a render and the queries that look for its result. Their wall time
// is that CPU time stretched by whatever else runs on the machine. Measured with three full
// suites at once (load average 130 to 200 on 10 cores), a wait that used 45 to 550 ms of CPU
// took 0.8 to 3.1 s, past Testing Library's 1 s default and Vitest's 5 s per test. These
// limits only end a hang, as the 30 s of the `core` and `server` projects do.
export const TEST_LIMIT_MILLISECONDS = 30_000;

// Below the limit of the test, so that a wait that never ends fails with Testing Library's
// message and its print of the page, not with Vitest's bare timeout.
export const WAIT_LIMIT_MILLISECONDS = 20_000;
