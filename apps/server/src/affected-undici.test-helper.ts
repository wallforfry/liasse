// Preloaded with `--import` by a process test: the process then reports the undici of
// Node 24.18, which the entry point must refuse, whatever Node runs the test.
Object.defineProperty(process, 'versions', {
  value: Object.freeze({ ...process.versions, node: '24.18.0', undici: '7.28.0' }),
});
