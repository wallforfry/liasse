import type { AutoApplyMode, SchemaLanguage } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import type { TextModel } from '../models/ports.ts';

export interface ConsolidationReadContext {
  readonly db: Database;
}

export interface ConsolidationContext extends ConsolidationReadContext {
  /** Merge candidates and field promotion each ask it; it never sees a document's text. */
  readonly textModel: TextModel;
  /** `auto_apply` of the settings. */
  readonly autoApply: AutoApplyMode;
  /** `schema_language` of the settings: the language of the field names a promotion proposes. */
  readonly schemaLanguage: SchemaLanguage;
}
