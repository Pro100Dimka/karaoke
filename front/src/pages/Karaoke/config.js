import { ShieldCheck, Zap } from "lucide-react";

export const MONITORING_MODES = [
  {
    id: "direct",
    title: "Прямой драйвер",
    description: "Минимальная задержка. Необходимы аудиодрайвер и наушники.",
    Icon: Zap
  },
  {
    id: "browser",
    title: "Совместимый",
    description: "Работает с обычными USB-микрофонами. Возможна задержка.",
    Icon: ShieldCheck
  }
];
