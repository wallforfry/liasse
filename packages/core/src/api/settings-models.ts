import type { SettingsModels, SettingsModelsRequest } from '@liasse/contract';
import { ModelListError } from '../models/errors.ts';
import { listModels } from '../models/providers/list-models.ts';
import { keyAfter, UNREADABLE_KEPT } from '../settings/draft.ts';
import { NO_KEYS } from '../settings/keys.ts';
import { readSettings } from '../settings/store.ts';
import { invalidRequest } from './errors.ts';
import type { SettingsContext } from './settings.ts';

const statusOf = (statusCode: number | undefined): string =>
  statusCode === undefined ? '' : ` with HTTP ${String(statusCode)}`;

// Only what Liasse wrote: the message of a provider may quote the request, its key included.
const failureOf = ({ provider, failure, statusCode, code }: ModelListError): SettingsModels => {
  const detail = code === undefined ? '' : ` (${code})`;
  switch (failure) {
    case 'rejected':
      return {
        status: 'failed',
        code: statusCode === 401 || statusCode === 403 ? 'unauthorized' : 'provider_error',
        message: `The provider ${provider} refused to list its models${statusOf(statusCode)}${detail}.`,
      };
    case 'unreachable':
      return {
        status: 'failed',
        code: 'unreachable',
        message: `The provider ${provider} could not be reached${detail}.`,
      };
    case 'timeout':
      return {
        status: 'failed',
        code: 'timeout',
        message: `The provider ${provider} did not list its models in time.`,
      };
    case 'invalid_answer':
      return {
        status: 'failed',
        code: 'invalid_answer',
        message: `The provider ${provider} answered, but not with a list of models.`,
      };
  }
};

/**
 * The models the provider of one section lists, with the endpoint as the form holds it.
 * A kept key is the stored key of that section. A failure of the provider is an answer,
 * so that the model can still be typed.
 */
export const listSettingsModels = async (
  context: SettingsContext,
  request: SettingsModelsRequest,
): Promise<SettingsModels> => {
  const keys = (await readSettings(context))?.keys ?? NO_KEYS;
  const key = keyAfter(request.api_key, keys[request.section]);
  if (key === undefined) {
    throw invalidRequest([{ path: ['api_key'], message: UNREADABLE_KEPT }]);
  }
  try {
    const models = await listModels({
      provider: request.provider,
      endpoint: { apiKey: key.key, baseUrl: request.base_url },
      purpose: request.section === 'llm' ? 'language' : 'embedding',
    });
    return { status: 'ok', models: [...models] };
  } catch (error) {
    if (error instanceof ModelListError) return failureOf(error);
    throw error;
  }
};
