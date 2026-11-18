import type { Source, SourceCreate, SourcePatch } from '@liasse/contract';
import {
  type FormValidation,
  type GeneralSourceValues,
  generalCreateDraftOf,
  generalPatchDraftOf,
  generalValuesOf,
  newGeneralValues,
  parseCreate,
  parsePatch,
} from './source-form.ts';

/** The form of a Drive source: its token comes from the consent, never from the form. */
export interface GdriveSourceValues extends GeneralSourceValues {
  /** A folder id, `root`, or the address of the folder in Drive. */
  readonly folder: string;
}

export type GdriveSource = Extract<Source, { readonly kind: 'gdrive' }>;

export const newGdriveValues = (): GdriveSourceValues => ({ ...newGeneralValues(), folder: '' });

export const gdriveValuesOf = (source: GdriveSource): GdriveSourceValues => ({
  ...generalValuesOf(source),
  folder: source.config.folder_id,
});

const DRIVE_HOST = 'drive.google.com';
// `/drive/folders/<id>`, or `/drive/u/<n>/folders/<id>` for an account other than the first.
const FOLDER_PATH = /^\/drive\/(?:u\/\d+\/)?folders\/(?<id>[^/]+)\/?$/u;

/**
 * The folder id the field names: the last part of a Drive folder address, or what was typed.
 * The schema judges the result, so an address of another kind is refused as an id.
 */
export const folderIdOf = (input: string): string => {
  const typed = input.trim();
  const address = URL.parse(typed);
  if (address?.hostname !== DRIVE_HOST) return typed;
  return FOLDER_PATH.exec(address.pathname)?.groups?.id ?? typed;
};

const configOf = (values: GdriveSourceValues) => ({ folder_id: folderIdOf(values.folder) });

export const validateGdriveCreate = (values: GdriveSourceValues): FormValidation<SourceCreate> =>
  parseCreate({ kind: 'gdrive', ...generalCreateDraftOf(values), config: configOf(values) });

export const validateGdrivePatch = (
  values: GdriveSourceValues,
  source: GdriveSource,
): FormValidation<SourcePatch> =>
  parsePatch({ kind: 'gdrive', ...generalPatchDraftOf(values), config: configOf(values) }, source);
