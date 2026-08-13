import { useI18n } from "../../i18n";

export default function Table({
  columns,
  data,
  renderRow,
  getRowKey,
  emptyText
}) {
  const { t } = useI18n();
  const rows = data ?? [];
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map(([key, title, className = ""]) => (
            <th key={key} className={className}>
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => (
          <tr key={getRowKey(item, index)}>
            {renderRow(item).map(([content, className = ""], cellIndex) => (
              <td
                key={columns[cellIndex]?.[0] ?? cellIndex}
                className={className}
              >
                {content}
              </td>
            ))}
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td
              colSpan={columns.length}
              className="table-empty text-muted u-empty-state"
            >
              {emptyText || t("common.noData")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
