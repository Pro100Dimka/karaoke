import { CheckCircle2, XCircle } from "lucide-react";

export const PIPELINE_CHECKS = [
  "ai_dir_found",
  "ffmpeg_available",
  "whisper_available",
  "demucs_available",
  "cuda_available",
  "torch_available"
];

export const STATUS_ICONS = { success: CheckCircle2, error: XCircle };
