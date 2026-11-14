export interface LocalModelSpec {
  readonly model: string;
  readonly cacheDir: string;
  // How long the model may take to answer one request before it is taken for stuck.
  readonly requestTimeoutMs?: number;
}

export interface LocalModel {
  // Raw sentence vectors, one per text and in the same order; not normalised.
  readonly embed: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
  // Tokens of each text for the model's tokenizer, special tokens excluded.
  readonly countTokens: (texts: readonly string[]) => Promise<readonly number[]>;
  readonly dispose: () => Promise<void>;
}

export type LocalModelLoader = (spec: LocalModelSpec) => Promise<LocalModel>;
