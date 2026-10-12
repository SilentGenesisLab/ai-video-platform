export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export class ProviderRejected extends HttpError {
  constructor(
    public httpStatus: number,
    message: string,
  ) {
    super(502, message, "PROVIDER_REJECTED");
  }
}
/** A definite validation/authentication/rate-limit rejection did not start inference. */
export function checkProviderResponse(response: Response, label: string) {
  if (response.ok) return;
  if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status))
    throw new ProviderRejected(
      response.status,
      `${label} HTTP ${response.status}`,
    );
  throw new HttpError(502, `${label} HTTP ${response.status}`);
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
  code?: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message, code);
}
