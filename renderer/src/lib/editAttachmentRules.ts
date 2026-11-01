/**
 * What an edit may leave on a message, post or comment: the limits each
 * composer holds to when sending, so anything the edit box allows could have
 * been sent that way (Tara, Nov 1 2026: adding a second video to a message
 * meant deleting it and posting it again).
 *
 * Copied from the website (lib/messages/edit-attachment-rules.ts): re-copy when it changes.
 * Shared by every edit box (website, iPhone and Mac keep copies) and checked
 * again by the edit routes. A video always goes in a message of its own, as on
 * send: no surface mixes videos with photos or files.
 */

export type EditSurface =
  | "channel"
  | "dm"
  | "hey-social-channel"
  | "hey-social-dm"
  | "post"
  | "comment";

export interface EditAttachmentRules {
  /** Photos and files together. */
  maxFiles: number;
  /** 0 where the composer cannot attach a video at all. */
  maxVideos: number;
}

export const EDIT_ATTACHMENT_RULES: Record<EditSurface, EditAttachmentRules> = {
  // One photo or file per message, or up to ten videos (ChannelComposer).
  channel: { maxFiles: 1, maxVideos: 10 },
  // Up to four photos and files, or one video (MessagesView).
  dm: { maxFiles: 4, maxVideos: 1 },
  // Slack's: ten files of any type; videos go to Mux in channels only.
  "hey-social-channel": { maxFiles: 10, maxVideos: 10 },
  "hey-social-dm": { maxFiles: 10, maxVideos: 0 },
  // Up to four photos, files or GIFs (the feed composer). Posts carry no videos.
  post: { maxFiles: 4, maxVideos: 0 },
  // Up to four photos, files or GIFs, or one video (CommentComposer).
  comment: { maxFiles: 4, maxVideos: 1 },
};

export type EditAttachmentProblem = string | null;

/**
 * Why a set of files can't be added, in the composer's own words — or null.
 * `files` and `videos` are what the message would hold afterwards, kept ones
 * included.
 */
export function editAttachmentProblem(
  surface: EditSurface,
  next: { files: number; videos: number },
): EditAttachmentProblem {
  const rules = EDIT_ATTACHMENT_RULES[surface];
  if (next.videos > 0 && next.files > 0) {
    return next.videos === 1 && rules.maxVideos === 1
      ? "A video is sent on its own, without photos or files. Remove one first."
      : "Videos go in a message of their own. Remove the photos and files first, or the videos.";
  }
  if (next.videos > 0 && rules.maxVideos === 0) return "Videos can't be added here.";
  if (next.videos > rules.maxVideos) {
    return rules.maxVideos === 1 ? "One video per message." : `Up to ${rules.maxVideos} videos per message.`;
  }
  if (next.files > rules.maxFiles) {
    if (surface === "channel") return "One photo or file per message.";
    if (surface === "post" || surface === "comment") {
      return `Up to ${rules.maxFiles} photos, files or GIFs per ${surface}.`;
    }
    return `You can attach up to ${rules.maxFiles} files to a message.`;
  }
  return null;
}
