// A child that asks the server to transcribe a page, waits as long as it takes, then
// answers with that text.
process.on('message', (message: { readonly type?: string; readonly markdown?: string }) => {
  if (message.type !== 'vision_result') return;
  process.send?.({
    type: 'result',
    result: {
      pages: [{ page: 1, text: message.markdown ?? '', method: 'vision' }],
      method: 'vision',
      attachments: [],
    },
  });
});
process.send?.({
  type: 'vision',
  id: 1,
  image: new Uint8Array([1]),
  mime: 'image/jpeg',
  prompt: 'synthetic',
});
