# Resource deletion

All eight resource collections expose DELETE /api/v1/{collection}/{id}; generic DELETE /api/v1/resources/{id} is also available. A request carries {"baseVersion":currentVersion} and an 8–200 character Idempotency-Key. The selected resource is archived, with unchanged content and source references, a new immutable revision and a resource.deleted audit event. Files, downstream references, running tasks and approval records remain intact. Archived entries can be restored through the existing versioned PATCH operation. Read/write module permissions, active membership and product scope are checked, including replay after permissions are tightened.

The card top-right button shows delete for active objects and restore for archived objects, opens a confirmation dialog and is hidden for read-only users. Product details also expose deletion in the header and warn about unsaved edits.

Validation: isolated PostgreSQL API integration covers all eight types, conflicts, idempotency, missing key, read-only and granular Agent permissions, cross-team isolation, revision/source preservation and retained files; browser tests cover top-right placement across modules, product detail deletion and creative score/filter/delete/restore on mobile; unit suite passes. No paid generation or customer-data deletion is performed during acceptance.
