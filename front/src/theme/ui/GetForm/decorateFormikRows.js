import { getIn } from "formik";
import SetFormikForApiField from "./SetFormikForApiField";

export default function decorateFormikRows(
  items,
  { formik, values = formik?.values, isSubmitting = formik?.isSubmitting } = {}
) {
  return items.map(({ lookUpTag, defaultApiValueRender, handleChange, filter_field, ...item }) => ({
    ...item,
    formik,
    ...(item.type?.includes("AutocompleteApi") && {
      defaultApiValue: defaultApiValueRender ?? item.defaultApiValue ?? getIn(values, lookUpTag),
      selectedItems:
        item.selectedItems ??
        ((data) =>
          handleChange
            ? handleChange(data)
            : SetFormikForApiField(formik, data, item.tag ?? item.name, filter_field, lookUpTag))
    }),
    ...(item.type === "Text" && { fontWeight: item.fontWeight ?? 500 }),
    disabled: isSubmitting || item.disabled
  }));
}
