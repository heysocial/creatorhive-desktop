import { nav } from "./nav";

/*
  Live popups: the website's lib/popups/types.ts, copied. The main process
  hands each one to the main window ("popup:show") after the Notifications
  switch, pause and lock; shell/LivePopups.tsx shows it.
*/

export type LivePopupKind = "reaction" | "comment" | "reply" | "mention" | "thread" | "dm" | "video";

export interface LivePopup {
  id: string;
  kind: LivePopupKind;
  actor: { id: string; name: string; avatarUrl: string | null };
  /** What happened, after the name: "liked your post", "mentioned you in #wins". */
  text: string;
  preview: string | null;
  /** Website path; openPath turns it into a place in the app. */
  href: string;
  workspace: "creatorhive" | "heysocial";
  at: string;
  conversationId?: string | null;
  channelId?: string | null;
  threadId?: string | null;
  postId?: string | null;
}

/** Already showing what it's about: that DM, that channel (or, inside a thread, that thread), that post. */
export function popupOnScreen(popup: LivePopup) {
  const view = nav.get().view;
  if (popup.conversationId) return view.kind === "dm" && view.id === popup.conversationId;
  if (popup.channelId) {
    if (view.kind !== "channel" || view.id !== popup.channelId) return false;
    return popup.threadId ? view.threadId === popup.threadId : true;
  }
  if (popup.postId) return view.kind === "feed" && view.postId === popup.postId;
  return false;
}
