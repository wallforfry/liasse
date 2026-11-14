import type { Entity, EntityTransaction } from './entity-store.ts';
import { bridgedBy, type NamedMention } from './exact-match.ts';
import { type NewProposal, recordProposal } from './proposal-store.ts';

const oldestFirst = (left: Entity, right: Entity): number => (left.id < right.id ? -1 : 1);

// The younger entity is the one to merge into the older, as for every merge candidate.
const pairOf = (left: Entity, right: Entity): readonly [source: Entity, target: Entity] => {
  const [target = left, source = right] = [left, right].toSorted(oldestFirst);
  return [source, target];
};

const sameKindBridge = (left: Entity, right: Entity): NewProposal => {
  const [source, target] = pairOf(left, right);
  return {
    sourceId: source.id,
    targetId: target.id,
    rationale: `One mention carried an identifier of "${source.canonicalName}" and one of "${target.canonicalName}"; nothing else says they are one entity.`,
    auto: false,
  };
};

const crossKindBridge = (resolved: Entity, carrier: Entity): NewProposal => {
  const [source, target] = pairOf(resolved, carrier);
  return {
    sourceId: source.id,
    targetId: target.id,
    rationale: `A mention of "${resolved.canonicalName}" (${resolved.kind}) carried an identifier of "${carrier.canonicalName}" (${carrier.kind}); a merge needs both to be of one kind.`,
    auto: false,
  };
};

// What a mention says about entities it was not attached to, kept for a person to judge:
// never applied without an approval, and recorded once per pair. Two entities of the kind
// of the resolved one whose identifiers the mention carried together may be one entity.
// So may the resolved one and an entity of another kind that carries an identifier of the
// mention, a sole trader entered as a person for instance.
export const bridgeProposals = (
  everyEntity: readonly Entity[],
  mention: NamedMention,
  resolved: Entity,
): readonly NewProposal[] => {
  const bridged = bridgedBy(everyEntity, mention).toSorted(oldestFirst);
  const [oldest, ...rest] = bridged.filter(({ kind }) => kind === resolved.kind);
  return [
    ...(oldest === undefined ? [] : rest.map((entity) => sameKindBridge(entity, oldest))),
    ...bridged
      .filter(({ kind }) => kind !== resolved.kind)
      .map((carrier) => crossKindBridge(resolved, carrier)),
  ];
};

export const recordBridges = async (
  tx: EntityTransaction,
  everyEntity: readonly Entity[],
  mention: NamedMention,
  resolved: Entity,
): Promise<void> => {
  for (const proposal of bridgeProposals(everyEntity, mention, resolved)) {
    await recordProposal(tx, proposal);
  }
};
