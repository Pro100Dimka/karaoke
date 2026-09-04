import { FormikProvider } from "formik";
import RenderFormikFields from "./RenderFormikFields";

export { default as appendData } from "./append-data";
export { default as decorateFormikRows } from "./decorateFormikRows";
export { default as getDataByFields } from "./get_data_by_fields";
export { default as mergeProperties, mergePropertiesWithNull } from "./mergeProperties";
export { default as RenderFormikFields } from "./RenderFormikFields";
export { default as SetFormikForApiField } from "./SetFormikForApiField";
export { default as useGetForm } from "./useGetForm";

export default function GetForm({
  formik,
  items = [],
  components,
  onFieldCommit,
  pickFolder,
  showForProps,
  gridProps,
  children,
  ...props
}) {
  if (!formik) throw new Error("GetForm: pass formik returned by useGetForm().");
  return (
    <FormikProvider value={formik}>
      <form noValidate {...props} onSubmit={formik.handleSubmit} onReset={formik.handleReset}>
        <RenderFormikFields
          {...gridProps}
          formik={formik}
          items={items}
          components={components}
          onFieldCommit={onFieldCommit}
          pickFolder={pickFolder}
          showForProps={showForProps}
        >
          {typeof children === "function" ? children(formik) : children}
        </RenderFormikFields>
      </form>
    </FormikProvider>
  );
}
