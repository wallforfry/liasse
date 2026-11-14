import { z } from 'zod';
import { loadOnceUntilLoaded, serveModelRequests } from './model-channel.ts';

// Entry point of the child process that runs the local embedding model. ONNX Runtime does not
// give its native memory back to the operating system when a session is released, so the model
// lives in a process of its own: ending the process is what frees the memory.

const [model, cacheDir] = process.argv.slice(2);
if (model === undefined || cacheDir === undefined) {
  throw new Error('usage: model-child <model> <cache directory>');
}

// Transformers.js 4.3 looks for the tokenizer files in its default cache only, whatever
// `cache_dir` a call passes, and then asks the network: the directory is therefore set as the
// default cache of this process, which makes a filled directory enough to work offline.
const transformers = async () => {
  const library = await import('@huggingface/transformers');
  library.env.cacheDir = cacheDir;
  return library;
};
// The tokenizer alone serves token counts: counting never loads the ONNX model.
const tokenizer = loadOnceUntilLoaded(async () =>
  (await transformers()).AutoTokenizer.from_pretrained(model),
);
const network = loadOnceUntilLoaded(async () =>
  (await transformers()).AutoModel.from_pretrained(model, { dtype: 'q8' }),
);

const vectorsSchema = z.array(z.array(z.number()));
const tokenIdsSchema = z.object({ input_ids: z.array(z.array(z.unknown())) });
const hiddenStateSchema = z.object({ last_hidden_state: z.unknown() });

// Mean pooling over the tokens the model read. A text longer than the model's window is
// truncated: callers size their texts with `countTokens` so that nothing is cut.
const embed = async (texts: readonly string[]): Promise<number[][]> => {
  const { mean_pooling: meanPooling, Tensor } = await transformers();
  const tokenize = await tokenizer();
  const inputs: unknown = tokenize([...texts], { padding: true, truncation: true });
  const output: unknown = await (await network())(inputs);
  const { last_hidden_state: hiddenState } = hiddenStateSchema.parse(output);
  const mask = z.object({ attention_mask: z.instanceof(Tensor) }).parse(inputs).attention_mask;
  const pooled = meanPooling(z.instanceof(Tensor).parse(hiddenState), mask);
  try {
    return vectorsSchema.parse(pooled.tolist());
  } finally {
    pooled.dispose();
  }
};

const countTokens = async (texts: readonly string[]): Promise<number[]> => {
  const tokenize = await tokenizer();
  const encoded: unknown = tokenize([...texts], {
    add_special_tokens: false,
    padding: false,
    truncation: false,
    return_tensor: false,
  });
  return tokenIdsSchema.parse(encoded).input_ids.map((ids) => ids.length);
};

serveModelRequests({ embed, countTokens });
