// A child entry that sends something that is no message of the protocol, then stays
// alive for as long as its parent keeps the channel open.
process.on('message', () => undefined);
process.send?.({ type: 'nonsense' });
