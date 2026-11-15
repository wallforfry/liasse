import { describe, expect, it } from 'vitest';
import { calibrate, type EntityName, entityNamesOf } from './thresholds.ts';

const CURRENT = { attach: 0.92, arbitrate: 0.8 };

const named = (entity: string, name: string, kind = 'org'): EntityName => ({ entity, kind, name });

// A unit vector at this angle from the first axis: the cosine of two of them is the
// cosine of the angle between them.
const at = (degrees: number): readonly number[] => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];

describe('entityNamesOf', () => {
  it('lists the canonical name and every alias, once each', () => {
    expect(
      entityNamesOf({
        entities: [
          {
            key: 'bank',
            kind: 'org',
            canonical_name: 'Crédit Yvrellois',
            aliases: ['Crédit Yvrellois', 'CY'],
            identifiers: [],
          },
        ],
      }),
    ).toEqual([named('bank', 'Crédit Yvrellois'), named('bank', 'CY')]);
  });
});

describe('calibrate', () => {
  it('suggests attaching above the closest two entities and arbitrating every alias', () => {
    // Names of one entity 10 and 30 degrees apart; of two entities, 20 degrees at least.
    const names = [named('a', 'A'), named('a', 'A2'), named('b', 'B'), named('b', 'B2')];
    const calibration = calibrate(names, [at(0), at(30), at(50), at(60)], CURRENT);
    expect(calibration.same.pairs).toBe(2);
    expect(calibration.different.pairs).toBe(4);
    expect(calibration.suggested).toEqual({
      attach: Math.ceil(Math.cos((20 * Math.PI) / 180) * 100) / 100,
      arbitrate: Math.floor(Math.cos((30 * Math.PI) / 180) * 100) / 100,
      // Of the names of one entity, the pair 10 degrees apart attaches and the other is
      // arbitrated; no names of two entities attach, the two 20 and 30 degrees apart are
      // arbitrated.
      sameAttached: 1,
      sameBelowArbitrate: 0,
      differentAttached: 0,
      differentArbitrated: 2,
    });
  });

  it('leaves nothing to arbitrate when the names of one entity are always the closest', () => {
    const names = [named('a', 'A'), named('a', 'A2'), named('b', 'B')];
    const calibration = calibrate(names, [at(0), at(5), at(80)], CURRENT);
    expect(calibration.suggested?.arbitrate).toBe(calibration.suggested?.attach);
  });

  it('compares names of one kind only, as resolution does', () => {
    const names = [named('a', 'A'), named('p', 'P', 'person')];
    const calibration = calibrate(names, [at(0), at(0)], CURRENT);
    expect(calibration.different.pairs).toBe(0);
    expect(calibration.suggested).toBeNull();
  });

  it('counts as arbitrated only what the attach threshold leaves to the text model', () => {
    const names = [named('a', 'A'), named('a', 'A2'), named('b', 'B'), named('c', 'C')];
    // c is 5 degrees from both names of a (attached), 35 from b (arbitrated); a and b are
    // 30 apart (arbitrated), A2 and b 40 (below arbitration).
    const { current } = calibrate(names, [at(0), at(10), at(-30), at(5)], CURRENT);
    expect(current).toMatchObject({ differentAttached: 2, differentArbitrated: 2 });
  });

  it('leaves out two equal names of one entity, which the name rule attaches first', () => {
    const names = [named('a', 'Synthétique'), named('a', 'SYNTHETIQUE'), named('a', 'Other')];
    const calibration = calibrate(names, [at(0), at(0), at(30)], CURRENT);
    expect(calibration.same.pairs).toBe(2);
    expect(calibration.same.max).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 10);
  });

  it('counts what the current thresholds attach and arbitrate', () => {
    const names = [named('a', 'A'), named('a', 'A2'), named('b', 'B')];
    // cos 10 = 0.985 between the two names of a; cos 30 = 0.866 and cos 40 = 0.766 to b.
    const { current } = calibrate(names, [at(0), at(10), at(-30)], CURRENT);
    expect(current).toMatchObject({
      sameAttached: 1,
      sameBelowArbitrate: 0,
      differentAttached: 0,
      differentArbitrated: 1,
    });
  });
});
