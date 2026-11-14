const LINE_FEED = 0x0a;

export interface LineScanner {
  readonly push: (chunk: Uint8Array) => void;
  /** Reports the last line when the stream did not end with a line feed. */
  readonly end: () => void;
}

// Reads a stream of any length line by line, lines being cut at line feeds alone, while
// holding at most `maxLineBytes` of it. A longer line is dropped whole, never reported in
// part: the end of a long line must not pass for the beginning of one.
export const createLineScanner = (
  maxLineBytes: number,
  onLine: (line: string) => void,
): LineScanner => {
  let pending = Buffer.alloc(0);
  let overlong = false;

  const extend = (part: Uint8Array): void => {
    if (overlong || pending.length + part.length > maxLineBytes) {
      overlong = true;
      pending = Buffer.alloc(0);
    } else {
      pending = Buffer.concat([pending, part]);
    }
  };

  const endLine = (): void => {
    if (!overlong) onLine(pending.toString('utf8'));
    pending = Buffer.alloc(0);
    overlong = false;
  };

  return {
    push: (chunk) => {
      let start = 0;
      for (
        let feed = chunk.indexOf(LINE_FEED);
        feed !== -1;
        feed = chunk.indexOf(LINE_FEED, start)
      ) {
        extend(chunk.subarray(start, feed));
        endLine();
        start = feed + 1;
      }
      extend(chunk.subarray(start));
    },
    end: () => {
      if (pending.length > 0) endLine();
    },
  };
};
