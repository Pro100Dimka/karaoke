import { COLUMNS } from "./config";
import ModelRow from "./row";

export default function ModelsTable({ models = [], dialogs }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {COLUMNS.map(({ id, title, className }) => (
            <th key={id} className={className}>
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(models ?? []).map((model) => (
          <ModelRow key={model.name} model={model} dialogs={dialogs} />
        ))}
      </tbody>
    </table>
  );
}
