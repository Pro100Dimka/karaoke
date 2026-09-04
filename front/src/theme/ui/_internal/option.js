export const optionItem = (option) =>
  typeof option === "object" ? option : { value: option, label: option };
