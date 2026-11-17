/** What to tell someone whose profile photo didn't save, from `ch.files.uploadForm`'s error. */
export function photoError(error: string | undefined, data: unknown) {
  if (error === "avatar_upload_rate_limited") return photoWait(data);
  if (error === "avatar_file_too_large") return "That photo is over 3 MB. Choose a smaller one.";
  if (error === "unsupported_avatar_type" || error === "invalid_avatar_image" || error === "empty_avatar_file") return "That photo couldn't be read. Try another one.";
  if (error === "timeout") return "The upload took too long. Check your connection and try again.";
  if (error === "offline") return "Your photo didn't upload. Check your connection and try again.";
  return "Your photo didn't upload. Try again.";
}

/** "Try again in 7 minutes", from the wait the server sends with a rate limit. */
function photoWait(data: unknown) {
  const seconds = Number((data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "You can change your photo again in a few minutes.";
  const minutes = Math.ceil(seconds / 60);
  return `You changed your photo recently. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`;
}
