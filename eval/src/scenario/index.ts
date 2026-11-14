import { CAR_INSURANCE_DOCUMENTS } from './car-insurance.ts';
import { ENERGY_DOCUMENTS } from './energy.ts';
import { HEALTH_DOCUMENTS } from './health.ts';
import { HOME_INSURANCE_DOCUMENTS } from './home-insurance.ts';
import { HOUSING_DOCUMENTS } from './housing.ts';
import { INTERNET_DOCUMENTS } from './internet.ts';
import { MOBILE_DOCUMENTS } from './mobile.ts';
import type { ScenarioDocument } from './model.ts';
import { MONEY_DOCUMENTS } from './money.ts';
import { PURCHASE_DOCUMENTS } from './purchases.ts';
import { TRAVEL_DOCUMENTS } from './travel.ts';
import { VEHICLE_DOCUMENTS } from './vehicle.ts';
import { WATER_DOCUMENTS } from './water.ts';
import { WORK_DOCUMENTS } from './work.ts';

// The household's papers, by theme. The order is the order of the files: a document that
// another one attaches or copies comes before it.
export const SCENARIO: readonly ScenarioDocument[] = [
  ...ENERGY_DOCUMENTS,
  ...WATER_DOCUMENTS,
  ...MOBILE_DOCUMENTS,
  ...INTERNET_DOCUMENTS,
  ...HOUSING_DOCUMENTS,
  ...HOME_INSURANCE_DOCUMENTS,
  ...CAR_INSURANCE_DOCUMENTS,
  ...VEHICLE_DOCUMENTS,
  ...WORK_DOCUMENTS,
  ...MONEY_DOCUMENTS,
  ...HEALTH_DOCUMENTS,
  ...PURCHASE_DOCUMENTS,
  ...TRAVEL_DOCUMENTS,
];

export { entityTruths, OWNER, REFERENCE_DATE, SUBJECTS } from './cast.ts';
export type { ScenarioDocument } from './model.ts';
