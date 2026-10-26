/* Admin → Moderation: built to match the website. Placeholder until it is. */
export function AdminModeration({ id }: { id?: string }) {
  return <div className="empty-state"><p>Admin Moderation{id ? ` (${id})` : ""} is coming.</p></div>;
}
