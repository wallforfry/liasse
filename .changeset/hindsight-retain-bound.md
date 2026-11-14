---
'@liasse/core': minor
'@liasse/server': patch
---

A forget no longer clears the record that the Hindsight bank may hold facts of a document while a retain of that document may still land. `documents.hindsight_retain_until`, added by migration `0009`, records until when a retain can reach Hindsight (the longest its request can take, retries included, now stated by `HindsightClient.requestWindowMs`); a forget within that bound is sent, keeps the record and throws `HindsightRetainInFlightError`, and the job runs again once the bound has passed. A retain whose sync lost its lock, or whose process died, can no longer leave facts in the bank with nothing to forget them.

A handler can defer its job without spending an attempt by throwing `DeferJobError` (`@liasse/core/jobs`), optionally with a delay; the workers report it through `onJobDeferred` instead of `onJobFailed`. The `hindsight_sync` handler defers a sync that finds another in progress, one that lost its lock and a forget a retain may still overtake. The server logs these as `job_deferred`, and logs the facts the detector kept out of Hindsight as `hindsight_facts_withheld`, with their count and nothing that names the document.
