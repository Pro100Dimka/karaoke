import { ShieldCheck, Zap } from "lucide-react";
import { translateSaved } from "../../i18n/runtime";

export const MONITORING_MODES = [
  {
    id: "direct",
    title: translateSaved("Прямой драйвер"),
    description: translateSaved(
      "Минимальная задержка. Необходимы аудиодрайвер и наушники."
    ),
    Icon: Zap
  },
  {
    id: "browser",
    title: translateSaved("Совместимый"),
    description: translateSaved(
      "Работает с обычными USB-микрофонами. Возможна задержка."
    ),
    Icon: ShieldCheck
  }
];
