import { MEMORY_SECTIONS } from "./config";
import { formatBytes } from "./format";

export default function MemoryBreakdown({ breakdown = {} }) {
  return (
    <div className="memory-breakdown">
      {Object.entries(breakdown).map(([key, bytes]) => (
        <article key={key} className="memory-breakdown-card">
          <span className="memory-breakdown-label">
            {MEMORY_SECTIONS[key] ?? key}
          </span>
          <strong className="memory-breakdown-value">
            {formatBytes(bytes)}
          </strong>
        </article>
      ))}
    </div>
  );
}
