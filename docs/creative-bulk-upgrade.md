# Creative workflow upgrade

Reference requests default to 50 TVC results and infer product image/brief when omitted. Website mounts the search controller after product/file load, preselects the image and brief, and initiates the first search with automatic:true. A product row lock prevents repeated automatic searches across tabs/browsers. Existing history suppresses automatic submission. Manual requests still create new history entries.

Creative pool adds batch selection (parentId), current-scope unscored count, per-card selection, select current page and batch selection/draft/rejection/archive. Each selected edit/delete carries its baseVersion; results report partial failures and refresh. No silent overwrite. The score request applies current product and batch scope.

Production investigation found many truncated model JSON responses. Scoring now disables reasoning, allows 8192 output tokens and requests short reasons. Failed items remain unscored; task reports partial_failed instead of misleading succeeded. Existing scores and current versions remain protected.
