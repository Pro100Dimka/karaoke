import { useFormik } from "formik";

// Positional arguments keep the hook from getFormik.zip usable as before.
export default function useGetForm(configOrValues, schema, submit) {
  const config =
    arguments.length > 1
      ? { initialValues: configOrValues, validationSchema: schema, onSubmit: submit }
      : configOrValues;
  return useFormik({
    enableReinitialize: true,
    validateOnChange: false,
    validateOnBlur: true,
    ...config
  });
}
