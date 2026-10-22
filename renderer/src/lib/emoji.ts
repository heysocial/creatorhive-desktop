/* A small, fixed emoji set for reactions and the composer, grouped like the website's picker. */

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🙌", "🎉", "👀", "💯"];

export const EMOJI_GROUPS: [string, string[]][] = [
  ["Smileys", ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😛", "😜", "🤪", "🤗", "🤭", "🤫", "🤔", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😌", "😔", "😴", "😷", "🤒", "🥵", "🥶", "🤯", "🥳", "😎", "🤓", "😕", "😟", "🙁", "😮", "😲", "😳", "🥺", "😢", "😭", "😱", "😤", "😡", "🤬", "💀", "🤡", "👻", "🤖"]],
  ["Gestures", ["👍", "👎", "👏", "🙌", "👐", "🤝", "🙏", "✌️", "🤞", "🤟", "🤘", "👌", "🤌", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "👋", "💪", "🫶", "✍️", "👀", "🧠", "🫡", "🤷", "🤦", "💁", "🙋", "🙆", "🙅"]],
  ["Hearts", ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"]],
  ["Things", ["🔥", "✨", "⭐", "🌟", "💫", "💯", "✅", "❌", "⚡", "💥", "🎉", "🎊", "🎁", "🏆", "🥇", "🥈", "🥉", "🎯", "🚀", "💰", "💵", "💸", "💎", "📈", "📉", "📌", "📎", "📝", "📅", "⏰", "📣", "📢", "💡", "🔔", "🎬", "🎥", "📸", "📱", "💻", "🎤", "🎧", "🛍️", "☕", "🍿", "🐝", "🍯", "🌈", "☀️", "🌙"]],
];

/** Text faces turned into emoji as you type, as the website does (`:)` → 🙂). */
export const EMOTICONS: Record<string, string> = {
  ":)": "🙂", ":-)": "🙂", ":D": "😄", ":-D": "😄", ";)": "😉", ";-)": "😉", ":(": "🙁", ":-(": "🙁",
  ":P": "😛", ":p": "😛", ":O": "😮", ":o": "😮", "<3": "❤️", ":'(": "😢", "B)": "😎",
};

/** Replace a text face just before the caret, once a space or line break follows it. */
export function convertEmoticon(value: string, caret: number): { value: string; caret: number } | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)(\S{2,3})(\s)$/.exec(before);
  if (!match) return null;
  const emoji = EMOTICONS[match[2]];
  if (!emoji) return null;
  const start = before.length - match[2].length - match[3].length;
  const next = `${value.slice(0, start)}${emoji}${match[3]}${value.slice(caret)}`;
  return { value: next, caret: start + emoji.length + match[3].length };
}
