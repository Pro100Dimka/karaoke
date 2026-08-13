import { useI18n } from "../../i18n";

export default function PageState({
  loading,
  error,
  empty,
  emptyTitle,
  children
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="page-state" role="status">
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-state page-state--error" role="alert">
        {error}
      </div>
    );
  }

  if (empty) {
    return <div className="page-state">{emptyTitle || t("common.noData")}</div>;
  }

  return children;
}
