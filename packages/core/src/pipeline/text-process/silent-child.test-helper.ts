// A child that never answers and uses no processor time: the IPC channel alone keeps it.
process.on('message', () => undefined);
