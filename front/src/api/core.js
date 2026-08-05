/* eslint-disable import/extensions */
// eslint-disable-next-line import/extensions
import { mockRequest } from "./mock/request.js";

// Общая транспортная часть локального REST API.
export const MOCK_API_ENABLED = import.meta.env?.VITE_USE_MOCK_API === "true";

export const BASE_URL =
  import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function request(path, options = {}) {
  if (MOCK_API_ENABLED) return mockRequest(path, options);

  const { headers, body, ...requestOptions } = options;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...requestOptions,
    body,
    headers:
      body instanceof FormData || body == null
        ? headers
        : { "Content-Type": "application/json", ...headers }
  });

  if (!response.ok) {
    let detail = response.statusText;

    try {
      const data = await response.json();
      detail =
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail ?? data);
    } catch {
      // Ответ может не содержать JSON-тело.
    }

    throw new Error(detail);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON в ответе ${response.url || path}`);
  }
}

const MOCK_SILENT_AUDIO_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

export function createFileUrl(path) {
  if (MOCK_API_ENABLED) return MOCK_SILENT_AUDIO_URL;
  return `${BASE_URL}${path}`;
}
