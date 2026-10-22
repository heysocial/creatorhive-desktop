import type { ClipboardEvent } from "react";
import { ch } from "./bridge";

/*
  Files from a paste, the way Slack takes them: copied files, pasted
  screenshots, and a picture copied from another app (which reaches the page
  only through the Mac clipboard, so the main process reads it).
  Returns null when the paste is just text, so the text pastes as usual.
*/
export async function pastedFiles(event: ClipboardEvent): Promise<File[] | null> {
  const data = event.clipboardData;
  const files = [...data.items].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean) as File[];
  if (files.length) {
    event.preventDefault();
    return files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Pasted image${files.length > 1 ? ` ${i + 1}` : ""} ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":", ".")}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type || "image/png" })));
  }
  if (data.getData("text/plain")) return null;
  event.preventDefault();
  const png = await ch.files.clipboardImage();
  if (!png) return null;
  return [new File([png as BlobPart], `Pasted image ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":", ".")}.png`, { type: "image/png" })];
}
