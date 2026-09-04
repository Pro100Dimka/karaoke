import { getIn, setIn } from "formik";
import mergeProperties from "./mergeProperties";

function assertPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path
      .split(/[.\[\]'"\s]+/)
      .some((part) => ["__proto__", "prototype", "constructor"].includes(part))
  ) {
    throw new Error(`GetForm: unsafe or empty field path: ${String(path)}`);
  }
}

export default function SetFormikForApiField(formik, data, defField, newDefField, obj) {
  assertPath(defField);
  if (obj) assertPath(obj);
  return formik.setValues((values) => {
    let next = values;
    if (obj) {
      const template = getIn(values, obj);
      let selected = data;
      if (template && typeof template === "object" && data != null) {
        selected = mergeProperties(template, data);
      } else if (
        data == null &&
        template &&
        !Array.isArray(template) &&
        typeof template === "object"
      ) {
        selected = Object.fromEntries(Object.keys(template).map((key) => [key, null]));
      }
      next = setIn(next, obj, selected);
    }
    const selectedValue = newDefField ? getIn(data, newDefField) : undefined;
    return setIn(next, defField, selectedValue === undefined ? data : selectedValue);
  });
}
