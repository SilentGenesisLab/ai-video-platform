# OpenRouter image fallback

OpenRouter provider uses the official `https://openrouter.ai/api/v1/images` endpoint, with `openai/gpt-image-2.5-flare` and `openai/gpt-image-2.5-sunburst`. Credentials use the existing encrypted Channel storage. Admin channel editor includes OpenRouter and both model names.

Only image requests whose original channel is absent or `auto` can fall back to OpenRouter after existing routes are exhausted. Explicit supplier selection does not use this final fallback. Only confirmed terminal failure without output or reported charges is eligible; timeout, unknown submission, cancellation and safety failures are excluded. Each task tries OpenRouter at most once. Legacy `gpt-image-2.5` maps to Flare; this is retained in the task input.

The original job, payer and frozen credits are retained; fallback records update the actual platform channel and preserve previous upstream results. OpenRouter returns synchronous base64 images. A successful response and its recoverable poll event are persisted transactionally before acknowledgement; download/OSS failure reuses that result instead of buying another image. A process crash before persistence remains submission_unknown and requires reconciliation.

USD usage and cost are saved as USD. They are not represented as CNY or settled against the old supplier rate. Successful OpenRouter usage enters reconciliation with the existing reservation retained until a verified RMB cost is supplied through the billing process. The user can receive the image while accounting is pending.

References: https://openrouter.ai/docs/guides/overview/multimodal/image-generation

Verification: typecheck, build and 60 unit tests passed. The supplied credential was validated using the read-only key endpoint and encrypted into production channel storage. Live generation acceptance is recorded separately below.

Production acceptance (2026-10-16): automatic legacy gpt-image-2.5 task `c516c5cf-3eac-48a6-8334-e0b158a00224` failed on initial routes, switched to OpenRouter Flare and succeeded. OSS file `590e615d-521f-48da-a0e5-700c393408bd` downloaded successfully (1,490,843 bytes) and visually inspected as the requested orange cat. Supplier cost recorded separately as USD 0.005995; CNY accounting remains pending. No credential or signed URL is included in this report.

Sunburst production acceptance: task `ef24a4b9-9e1d-47f5-abd8-d01352270758` succeeded directly on the configured OpenRouter channel. The generated OSS image downloaded successfully (1,434,970 bytes). Both requested model variants have now produced real images; automatic failure-to-Flare fallback was also verified end to end. Web and Worker run the OpenRouter release image; the encrypted credential remains only in the server database.
