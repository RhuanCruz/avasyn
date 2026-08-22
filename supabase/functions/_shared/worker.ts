// Helpers for talking to the external video worker (yt-dlp + ffmpeg).

/**
 * Unwraps an error response from the video worker.
 *
 * The worker answers failures with `{"error": "..."}`. Passing the raw body
 * straight through puts that JSON blob in front of the user, so unwrap it and
 * fall back to the plain text only when the body is not the expected shape.
 */
export async function readWorkerError(response: Response): Promise<string> {
  const text = (await response.text()).trim();

  if (!text) {
    return `Video worker responded ${response.status}`;
  }

  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const message = payload?.error ?? payload?.message;
    if (message) return String(message);
  } catch {
    // Not JSON — the raw text is the best we have.
  }

  return text;
}
