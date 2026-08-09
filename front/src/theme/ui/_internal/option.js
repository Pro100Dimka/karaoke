export const optionText = option =>
  typeof option === "string" || typeof option === "number"
    ? String(option)
    : String(option?.label ?? option?.value ?? "");

export const optionItem = option =>
  typeof option === "object" ? option : { value: option, label: option };
