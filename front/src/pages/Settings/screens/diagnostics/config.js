import { CheckCircle2, XCircle } from "lucide-react";

export const PIPELINE_CHECKS = [
  ["ai_dir_found", "AI Pipeline найден"],
  ["ffmpeg_available", "FFmpeg найден"],
  ["whisper_available", "Whisper найден"],
  ["demucs_available", "Demucs найден"],
  ["cuda_available", "CUDA доступна"],
  ["torch_available", "Torch установлен"]
];

export const STATUS_ICONS = { success: CheckCircle2, error: XCircle };
