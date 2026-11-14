import type { SensitiveDetector } from './memory.ts';

/** A synthetic identifier, shaped like the start of an IBAN. */
export const SYNTHETIC_IDENTIFIER = 'FR76 0000 0000 0000 SYNTHETIC 000';

// Stands for the detector of sensitive identifiers the server binds.
export const flagsSyntheticIdentifiers: SensitiveDetector = (text) => text.includes('FR76');

export const flagsNothing: SensitiveDetector = () => false;
