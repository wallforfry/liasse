import type { Database } from '../db/client.ts';
import type { AutoApplyMode, SchemaLanguage } from '../domain/enums.ts';
import type { TextModel } from '../models/ports.ts';

export interface ConsolidationReadContext {
  readonly db: Database;
}

export interface ConsolidationContext extends ConsolidationReadContext {
  /** Merge candidates and field promotion each ask it; it never sees a document's text. */
  readonly textModel: TextModel;
  /** `AUTO_APPLY` of the configuration. */
  readonly autoApply: AutoApplyMode;
  /** `SCHEMA_LANGUAGE`: the language of the field names a promotion proposes. */
  readonly schemaLanguage: SchemaLanguage;
}
