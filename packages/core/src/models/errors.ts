export class ModelOutputError extends Error {
  override readonly name = 'ModelOutputError';
  readonly model: string;

  constructor(model: string, reason: string, options?: ErrorOptions) {
    super(`Model ${model} returned an output that does not match the schema: ${reason}`, options);
    this.model = model;
  }
}
