import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { TypeStatus } from '../domain/enums.ts';

const OWN_TYPE = 'own_type';
const LIVE_TYPE = 'live_type';
const MERGED: TypeStatus = 'merged';

const ownType = alias(docTypes, OWN_TYPE);

// The type a document belongs to today: its own, or the one that absorbed it. A merge
// leaves the documents of the source where they are and hands its slug to the target as
// an alias, and a name has a single holder that is not merged.
export const liveType = alias(docTypes, LIVE_TYPE);

export const documentSource = sql`${documents}
  LEFT JOIN ${docTypes} AS ${sql.identifier(OWN_TYPE)} ON ${ownType.id} = ${documents.typeId}
  LEFT JOIN ${docTypes} AS ${sql.identifier(LIVE_TYPE)} ON ${liveType.status} <> ${MERGED}
    AND (${liveType.id} = ${ownType.id}
      OR (${ownType.status} = ${MERGED} AND ${liveType.aliases} @> ARRAY[${ownType.slug}]))`;
