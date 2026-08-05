export default function PageState({
  loading,
  error,
  empty,
  emptyTitle,
  children
}) {
  if (loading) {
    return (
      <div className="page-state" role="status">
        Загрузка…
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
    return <div className="page-state">{emptyTitle || "Нет данных"}</div>;
  }

  return children;
}
