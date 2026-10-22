/*
  Commands come from the Mac menu bar (their shortcuts are the menu's own
  accelerators), the menu bar icon and the interface itself, and all land here.
*/

export type Command =
  | "back" | "forward" | "quick-open" | "shortcuts" | "settings" | "new-message" | "new-post" | "new-deal" | "export" | "popout" | "toggle-sidebar" | "sign-out"
  | "go:home" | "go:dms" | "go:hub" | "go:learn" | "go:activity"
  | "workspace:ch" | "workspace:hs";

type Handler = (command: Command) => void;
const handlers = new Set<Handler>();

export const commands = {
  run(command: Command) {
    handlers.forEach((handler) => handler(command));
  },
  on(handler: Handler) {
    handlers.add(handler);
    return () => void handlers.delete(handler);
  },
};
