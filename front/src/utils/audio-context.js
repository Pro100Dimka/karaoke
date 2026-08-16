export async function closeAudioContext(context) {
  if (!context?.close || context.state === "closed") return false;
  try {
    await Promise.resolve(context.close());
    return true;
  } catch {
    return false;
  }
}

export function closeAudioContextQuietly(context) {
  closeAudioContext(context);
}
