---
'@liasse/core': minor
---

Add entity resolution (`@liasse/core/entities`): `resolveEntity` attaches a mention to an entity by strong identifier, normalized name, then similarity (attached above 0.92, arbitrated by the text model from 0.80), or creates it; `listEntities` and `getEntity` read entities with their document count; `mergeEntities`, `proposeEntityMerge` and `findMergeCandidates` merge duplicates through `merge_entity` changes. IBANs and card numbers are stored as their last four characters and an HMAC-SHA-256 keyed from `FILE_URL_SECRET`: changing that secret makes the stored ones unknown to resolution until they are met again. `findSensitiveIdentifiers` and `redactSensitiveIdentifiers` find and mask them in a text. Entity names are now compared on the letters and digits of every script, not only the Latin ones.
