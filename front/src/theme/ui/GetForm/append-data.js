export default function appendData(values) {
  const result = new FormData();
  const isBlob = (value) => typeof Blob !== "undefined" && value instanceof Blob;
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) && ["Images", "files", "fk_files"].includes(key)) {
      for (const item of value) {
        result.append(key, isBlob(item) ? item : JSON.stringify(item));
        result.append(`${key}_JSON`, JSON.stringify(item));
      }
    } else if (isBlob(value)) {
      result.append(key, value);
    } else if (value !== null && typeof value === "object") {
      result.append(key, JSON.stringify(value));
    } else {
      result.append(key, value ?? "");
    }
  }
  return result;
}
