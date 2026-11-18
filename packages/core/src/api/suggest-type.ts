import {
  type TypeSuggestion,
  type TypeSuggestionRequest,
  typeSuggestionRequestSchema,
} from '@liasse/contract';
import {
  EmbeddingOutputError,
  LocalModelProcessError,
  LocalModelRequestError,
} from '../embeddings/errors.ts';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import type { ApiContext } from './context.ts';
import { ApiError, notImplemented } from './errors.ts';

// The embedder ranks the closest types before the text model is called: either failing
// leaves the request valid, and the same one may succeed later.
const MODEL_FAILURES = [
  ModelProviderError,
  ModelOutputError,
  EmbeddingOutputError,
  LocalModelProcessError,
  LocalModelRequestError,
] as const;

/**
 * Drafts a type with the text model, for a person to review and send to `createType`.
 * A model that fails or answers out of schema is reported as unavailable.
 */
export const suggestType = async (
  { features }: Pick<ApiContext, 'features'>,
  input: TypeSuggestionRequest,
): Promise<TypeSuggestion> => {
  if (features.suggestType === undefined) throw notImplemented('type suggestions');
  const { request } = typeSuggestionRequestSchema.parse(input);
  try {
    return await features.suggestType(request);
  } catch (error) {
    if (MODEL_FAILURES.some((failure) => error instanceof failure)) {
      throw new ApiError(
        'model_unavailable',
        'The text model could not draft the type; try again or create it by hand.',
      );
    }
    throw error;
  }
};
