import { CSP_NONCE_META_PROPERTY } from '@liasse/contract';

/**
 * The nonce the server wrote into this page for the style elements inserted at run time.
 * Browsers hide the `nonce` attribute once the policy applies, but keep the property.
 */
export const cspNonce = (): string | undefined => {
  const meta = document.querySelector(`meta[property="${CSP_NONCE_META_PROPERTY}"]`);
  return meta instanceof HTMLElement && meta.nonce !== '' ? meta.nonce : undefined;
};
