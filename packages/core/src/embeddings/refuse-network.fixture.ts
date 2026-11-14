// Preloaded into the model process by the model tests: any download attempt fails.
globalThis.fetch = () => Promise.reject(new Error('network access is disabled in this test'));
