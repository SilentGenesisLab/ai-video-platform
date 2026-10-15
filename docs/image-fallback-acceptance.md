# Image failover live acceptance — 2026-10-16

Merged origin/main (creative detail editors and browser navigation fixes) into main without conflicts.

Two actual production image batches were submitted through authenticated business APIs with normal quotes and personal wallets:
- `72d3e1e4-dfde-41db-a640-7ad5f002faa3`: gpt-image-2.5/auto failed on grsai; platform automatically tried gpt-image-2.5-flare/teamorouter. Supplier routed this back to grsai and returned maintenance failure, fallback_count=1.
- `f88c7b30-d0d7-405b-a41b-a653c939b383`: gpt-image-2/auto failed; automatic teamorouter retry also returned grsai maintenance failure.

No image was delivered. Automatic switching was exercised, but successful backup generation is NOT verified. Upstream route health/bindings must be repaired before this can be considered operational. Production provider API docs list TeamORouter support but live behavior did not provide an available route. Do not repeatedly buy more attempts while all advertised routes are unavailable.

First batch personal balance unchanged after settlement; failed attempts retained in job input. Corrected terminal failure updates to retain actual provider channel rather than submission-time requested channel.

Typecheck, production build and 58 unit tests passed after merge. Private request details and credentials remain outside Git.
