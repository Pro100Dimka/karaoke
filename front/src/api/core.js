/* eslint-disable import/extensions */
// eslint-disable-next-line import/extensions
import { mockBlobRequest, mockRequest } from "./mock/request.js";

// Общая транспортная часть локального REST API.
export const MOCK_API_ENABLED = import.meta.env?.VITE_USE_MOCK_API === "true";

const configuredBaseUrl =
  import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const BASE_URL = String(configuredBaseUrl).replace(/\/+$/, "");

function normalizeHeaders(headers) {
  if (!headers) return undefined;
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function hasContentType(headers) {
  return Object.keys(headers || {}).some(
    (name) => name.toLowerCase() === "content-type"
  );
}

function buildRequestOptions(options = {}) {
  const { headers, body, ...requestOptions } = options;
  const FormDataCtor = globalThis.FormData;
  const isFormData =
    typeof FormDataCtor === "function" && body instanceof FormDataCtor;
  const normalizedHeaders = normalizeHeaders(headers);

  if (isFormData || body == null) {
    return {
      ...requestOptions,
      body,
      ...(normalizedHeaders ? { headers: normalizedHeaders } : {})
    };
  }

  const nextHeaders = normalizedHeaders || {};
  if (typeof body === "string" && !hasContentType(nextHeaders)) {
    nextHeaders["Content-Type"] = "application/json";
  }

  return { ...requestOptions, body, headers: nextHeaders };
}

async function readErrorDetail(response) {
  let detail = response.statusText || `HTTP ${response.status}`;

  try {
    const data = await response.json();
    detail =
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail ?? data);
  } catch {
    // Ответ может не содержать JSON-тело.
  }

  return detail;
}

async function fetchSuccessfulResponse(path, options) {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("Fetch API недоступен в текущем окружении");
  }
  const normalizedPath = String(path || "");
  const requestPath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  const response = await globalThis.fetch(
    `${BASE_URL}${requestPath}`,
    buildRequestOptions(options)
  );
  if (!response.ok) {
    const error = new Error(await readErrorDetail(response));
    error.status = response.status;
    error.url = response.url || `${BASE_URL}${requestPath}`;
    throw error;
  }
  return response;
}

export function encodePathSegment(value) {
  const segment = String(value ?? "").trim();
  if (!segment) throw new TypeError("Пустой идентификатор API-ресурса");
  return encodeURIComponent(segment);
}

export async function request(path, options = {}) {
  if (MOCK_API_ENABLED) return mockRequest(path, options);

  const response = await fetchSuccessfulResponse(path, options);
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON в ответе ${response.url || path}`);
  }
}

export async function requestBlob(path, options = {}) {
  if (MOCK_API_ENABLED) return mockBlobRequest(path, options);
  const response = await fetchSuccessfulResponse(path, options);
  return response.blob();
}

const MOCK_SILENT_AUDIO_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

export function createFileUrl(path) {
  if (MOCK_API_ENABLED) return MOCK_SILENT_AUDIO_URL;
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) return BASE_URL;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath)) {
    throw new TypeError("Ожидался локальный путь к файлу API");
  }
  const requestPath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return `${BASE_URL}${requestPath}`;
}
