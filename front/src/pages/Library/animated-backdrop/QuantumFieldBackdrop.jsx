import { useMemo } from "react";

// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftRuntimeUrl from "./qftRuntime.js?worker&url";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftSource from "./qftvisualizer.html?raw";
import "./quantum-field.css";

// Upstream: https://github.com/stridentsoundworks-spec/gftvisualizer
// Commit: 7958ba432beef5f72d2adf46b4a4f800d13255d0
function makeEmbeddedSource(source) {
  return source.replace(
    /<script type="module">[\s\S]*?<\/script>\s*<\/body>/,
    `<script type="module" src="${qftRuntimeUrl}"></script></body>`
  );
}

export default function QuantumFieldBackdrop() {
  const source = useMemo(() => makeEmbeddedSource(qftSource), []);

  return (
    <div className="qft-original-backdrop">
      <iframe
        className="qft-original-frame"
        title="Quantum Fields visualizer"
        srcDoc={source}
        allow="autoplay; microphone; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      />
    </div>
  );
}
