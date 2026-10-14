# Key authorization · 1.5.2

`GET /auth/me` returns current effective `permissions`, compatibility `scopes`, `productScopeMode` and `productIds` in the fixed team. An explicit `selected` scope is never treated as all products, including when empty. All mode permits current and future products in that team. Product selection cannot cross teams. An Agent run also has its original permission/product snapshot and intersects it with current Key permissions; expanding a Key does not expand an existing run.

| Module                                           | Permissions                                            |
| ------------------------------------------------ | ------------------------------------------------------ |
| Product                                          | `product.read`, `product.write`                        |
| Ideas / plans / storyboards                      | `creative.read`, `creative.write`, `creative.generate` |
| Assets / image / music                           | `asset.read`, `asset.write`, `asset.generate`          |
| Scripts / deliverables / video                   | `video.read`, `video.write`, `video.generate`          |
| Files                                            | `file.read`, `file.write`, `file.analyze`              |
| Conversations                                    | `chat.read`, `chat.execute`, `chat.control`            |
| Safe model metadata                              | `channel.read`                                         |
| Optional audit / personal credits and team usage | `operations.logs`, `operations.billing`                |

Write, generate, analyze, execute and control depend on that module's read permission. `chat.execute` also requires the owner's legacy write/generate capabilities. Business operations reading a product, plan, source asset or referenced file additionally require permission to read that source module. Product context omits inaccessible resources/files. Mixed task/batch lists omit inaccessible modules. Upload with `parsePolicy: "skip"` needs file read/write; automatic parsing additionally needs file.analyze. Conversation attachments defer parsing; sending unread attachments for extraction requires file.analyze. Media quotations are free and use creative/asset/video generation permission rather than optional billing visibility. Image jobs targeting a storyboard require creative.generate; normal image/music use asset.generate.

Key management is human-session only: `/api-keys/options?ownerId=...` returns the catalog, dependencies, grantable items and recommended selection. Creation and PATCH accept `permissions`, `productScopeMode` and `productIds`; specify all three when changing authorization. Selected mode requires at least one product; all mode uses an empty productIds array. Old Key scopes map to their previous capabilities. A legacy client may update fine Key metadata without dropping authorization, but changing coarse scopes or implicitly expanding selected scope returns 409 (`KEY_PERMISSION_CONFLICT` / `KEY_SCOPE_CONFLICT`). Read the new structure and ask the human owner to update it. Key instructions expose selected effective permissions and range only to the authorized human session; never publish them.

Example human management payload (not available to Agent Keys):

```json
{
  "name": "Product editor",
  "permissions": ["product.read", "product.write"],
  "productScopeMode": "selected",
  "productIds": ["product-uuid"],
  "enabled": true
}
```

Installation verification only calls `/auth/me`; it creates no business data and purchases no generation. Never print keys, embed them in URLs, or write them in the public Skill.
