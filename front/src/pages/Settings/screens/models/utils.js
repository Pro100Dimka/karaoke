import { BYTES_IN_MB } from "./config";

export const formatModelSize = ({
  disk_size_bytes: diskSizeBytes,
  approx_size_mb: approximateSizeMb
}) =>
  diskSizeBytes
    ? `${Math.round(diskSizeBytes / BYTES_IN_MB)} MB`
    : `~${approximateSizeMb} MB`;

export async function runDialogAction(action, model, dialogs) {
  const { alert: notify, confirm: confirmDialog } = dialogs;
  const confirmationMessage = action.confirm?.(model);
  if (confirmationMessage) {
    const confirmed = await confirmDialog(confirmationMessage);
    if (!confirmed) return;
  }
  try {
    await action.request(model.name);
  } catch (error) {
    await notify(error.message || "Не удалось выполнить действие");
  }
}
