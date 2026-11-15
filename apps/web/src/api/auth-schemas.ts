import { z } from 'zod';

// The JSON parser of the auth client turns ISO timestamps into dates on its own.
const timestamp = z.coerce.date();

/** `get-session`: the live session of this browser, or null. */
export const sessionAnswerSchema = z
  .object({
    session: z.object({ id: z.string() }),
    user: z.object({ email: z.string() }),
  })
  .nullable();

/** Where the auth server sends the browser next, to continue an OAuth authorization. */
export const redirectAnswerSchema = z.object({ redirect: z.literal(true), url: z.string() });

/** `sign-in/email`: signed in here, or sent on to the OAuth client. */
export const signInAnswerSchema = z.union([
  redirectAnswerSchema,
  z.object({ redirect: z.literal(false) }),
]);

/** `oauth2/public-client`: what the consent page may show of the client asking for access. */
export const publicClientSchema = z.object({
  client_id: z.string(),
  client_name: z.string().nullish(),
  client_uri: z.string().nullish(),
});

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** The first characters of the key, to tell keys apart. */
  start: z.string().nullable(),
  createdAt: timestamp,
  expiresAt: timestamp.nullable(),
  lastRequest: timestamp.nullable(),
});

export type ApiKey = z.output<typeof apiKeySchema>;

export const apiKeyListSchema = z.object({ apiKeys: z.array(apiKeySchema) });

/** `api-key/create`: the only answer that holds the whole key. */
export const createdApiKeySchema = z.object({ key: z.string() });
