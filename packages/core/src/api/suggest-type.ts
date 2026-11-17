import {
  type TypeSuggestion,
  type TypeSuggestionRequest,
  typeSuggestionRequestSchema,
} from '@liasse/contract';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import type { ApiContext } from './context.ts';
import { ApiError, notImplemented } from './errors.ts';

/**
 * Drafts a type with the text model, for a person to review and send to `createType`.
 * A model that fails or answers out of schema is reported as unavailable: the request
 * itself was valid, and the same one may succeed later.
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
    if (error instanceof ModelProviderError || error instanceof ModelOutputError) {
      throw new ApiError(
        'unavailable',
        'model_unavailable',
        'The text model could not draft the type; try again or create it by hand.',
      );
    }
    throw error;
  }
};
