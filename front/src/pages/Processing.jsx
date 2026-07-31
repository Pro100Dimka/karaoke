import { useLocation } from "react-router-dom";
import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel, StatusBadge, ProgressBar } from "../components/ui";
import { OctagonX } from "lucide-react";

const STEP_LABELS = [
  "Загрузка и проверка файла", "Конвертация аудио", "Разделение на вокал и инструментал",
  "Распознавание речи (Whisper)", "Выравнивание текста", "Определение тональности и темпа",
  "Определение диапазона", "Извлечение мелодии", "Генерация MIDI-нот",
  "Создание караоке-дорожки", "Генерация субтитров", "Сохранение результатов", "Финализация",
];

function formatEta(seconds) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `~${m} мин ${s} сек` : `~${s} сек`;
}

export default function Processing() {
  const location = useLocation();
  const [songId, setSongId] = useState(location.state?.songId || null);
  const { data: songs } = usePolling(api.listSongs, 3000, []);

  const activeSong = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || []).find((s) => s.status === "processing" || s.status === "cancelling");

  const { data: status } = usePolling(
    () => (activeSong ? api.getStatus(activeSong.id) : Promise.resolve(null)),
    1000,
    [activeSong?.id]
  );
  const { data: logData } = usePolling(
    () => (activeSong ? api.getLog(activeSong.id) : Promise.resolve(null)),
    1500,
    [activeSong?.id]
  );

  if (!activeSong) {
    return (
      <Panel title="Обработка песни">
        <p className="text-muted">
          Сейчас ничего не обрабатывается. Запустите обработку из{" "}
          <b>Библиотеки</b> — прогресс появится здесь.
        </p>
      </Panel>
    );
  }

  const currentStepIndex = status ? Math.floor(parseFloat(status.progress_step || "0")) : 0;

  const handleCancel = async () => {
    if (!confirm("Отменить обработку этой песни?")) return;
    try {
      await api.cancelProcessing(activeSong.id);
    } catch (err) {
      alert(`Не удалось отменить: ${err.message}`);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <Panel
        title="Обработка песни"
        actions={
          (status?.status === "processing" || status?.status === "queued") && (
            <button className="btn btn-danger" onClick={handleCancel}>
              <OctagonX size={14} /> Отменить обработку
            </button>
          )
        }
      >
        <h2 style={{ margin: "0 0 4px" }}>{activeSong.title}</h2>
        <StatusBadge status={status?.status || activeSong.status} />

        <div style={{ margin: "18px 0 6px", display: "flex", justifyContent: "space-between" }}>
          <span className="text-secondary" style={{ fontSize: 13 }}>
            Шаг {status?.progress_step || "0/13"}
          </span>
          <span style={{ fontWeight: 700 }}>{status?.progress_percent ?? 0}%</span>
        </div>
        <ProgressBar percent={status?.progress_percent ?? 0} />

        <div style={{ marginTop: 14, fontSize: 13 }} className="text-secondary">
          Осталось примерно: {formatEta(status?.eta_seconds)}
        </div>

        {status?.error_message && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {status.error_message}
          </div>
        )}

        <ol style={{ marginTop: 18, paddingLeft: 20, fontSize: 13 }}>
          {STEP_LABELS.map((label, idx) => {
            const stepNum = idx + 1;
            const done = stepNum < currentStepIndex || status?.status === "done";
            const active = stepNum === currentStepIndex && status?.status === "processing";
            return (
              <li
                key={label}
                style={{
                  marginBottom: 6,
                  color: done ? "var(--success)" : active ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: active ? 700 : 400,
                }}
              >
                {label} {done && "— готово"} {active && "— в процессе..."}
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel title="Лог обработки">
        <div
          style={{
            fontFamily: "Consolas, monospace",
            fontSize: 11.5,
            lineHeight: 1.6,
            maxHeight: 560,
            overflowY: "auto",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {(logData?.lines || []).length === 0 && <span className="text-muted">Лог пока пуст...</span>}
          {(logData?.lines || []).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
