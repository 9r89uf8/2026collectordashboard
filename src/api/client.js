export const API_BASE_PATH = "/api";

/** Base class for failures produced after an API request reaches fetch. */
export class ApiError extends Error {
  constructor(message, { url, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.url = url ?? null;
  }
}

/** A response was received, but its HTTP status was not successful. */
export class HttpError extends ApiError {
  constructor(response, body = null) {
    super(
      `API request failed with HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }`,
      { url: response.url },
    );
    this.name = "HttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
    this.response = response;
  }
}

/** A successful response did not contain valid JSON. */
export class JsonError extends ApiError {
  constructor(response, { body = "", cause } = {}) {
    super("API returned an invalid JSON response", {
      url: response.url,
      cause,
    });
    this.name = "JsonError";
    this.status = response.status;
    this.body = body;
    this.response = response;
  }
}

// Descriptive aliases make call sites/tests readable without fragmenting the
// actual error hierarchy.
export const ApiHttpError = HttpError;
export const ApiJsonError = JsonError;

export function apiUrl(path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new TypeError("API path must be a non-empty string");
  }

  if (/^(?:[a-z]+:)?\/\//i.test(path)) {
    throw new TypeError("API requests must use a proxy-relative path");
  }

  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (
    withLeadingSlash === API_BASE_PATH ||
    withLeadingSlash.startsWith(`${API_BASE_PATH}/`) ||
    withLeadingSlash.startsWith(`${API_BASE_PATH}?`)
  ) {
    return withLeadingSlash;
  }

  return `${API_BASE_PATH}${withLeadingSlash}`;
}

function parseBody(text) {
  if (text === "") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Fetch JSON through the Vite `/api` proxy.
 *
 * Network and AbortErrors are intentionally left untouched. Callers can use
 * `error.name === "AbortError"` without knowing about this wrapper. Received
 * HTTP and JSON failures are represented by HttpError and JsonError.
 */
export async function requestJson(
  path,
  {
    signal,
    live = false,
    cache,
    headers,
    fetchImpl = globalThis.fetch,
    ...requestInit
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }

  const url = apiUrl(path);
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) {
    requestHeaders.set("Accept", "application/json");
  }

  const init = {
    method: "GET",
    ...requestInit,
    headers: requestHeaders,
    signal,
  };

  if (cache !== undefined) {
    init.cache = cache;
  } else if (live) {
    init.cache = "no-store";
  }

  const response = await fetchImpl(url, init);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new HttpError(response, parseBody(bodyText));
  }

  try {
    return JSON.parse(bodyText);
  } catch (cause) {
    throw new JsonError(response, { body: bodyText, cause });
  }
}
