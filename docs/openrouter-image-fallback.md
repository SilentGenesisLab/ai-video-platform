# OpenRouter image fallback

OpenRouter provider uses the official `https://openrouter.ai/api/v1/images` endpoint, with `openai/gpt-image-2.5-flare` and `openai/gpt-image-2.5-sunburst`. Credentials use the existing encrypted Channel storage. Admin channel editor includes OpenRouter and both model names.

Only image requests whose original channel is absent or `auto` can fall back to OpenRouter after existing routes are exhausted. Explicit supplier selection does not use this final fallback. Only confirmed terminal failure without output or reported charges is eligible; timeout, unknown submission, cancellation and safety failures are excluded. Each task tries OpenRouter at most once. Legacy `gpt-image-2.5` maps to Flare; this is retained in the task input.

The original job, payer and frozen credits are retained; fallback records update the actual platform channel and preserve previous upstream results. OpenRouter returns synchronous base64 images. A successful response and its recoverable poll event are persisted transactionally before acknowledgement; download/OSS failure reuses that result instead of buying another image. A process crash before persistence remains submission_unknown and requires reconciliation.

USD usage and cost are saved as USD. They are not represented as CNY or settled against the old supplier rate. Successful OpenRouter usage enters reconciliation with the existing reservation retained until a verified RMB cost is supplied through the billing process. The user can receive the image while accounting is pending.

References: https://openrouter.ai/docs/guides/overview/multimodal/image-generation

Verification: typecheck, build and 60 unit tests passed. The supplied credential was validated using the read-only key endpoint and encrypted into production channel storage. Live generation acceptance is recorded separately below.
