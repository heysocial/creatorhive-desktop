/* Admin → Hubs: built to match the website. Placeholder until it is. */
export function AdminHubs({ id }: { id?: string }) {
  return <div className="empty-state"><p>Admin Hubs{id ? ` (${id})` : ""} is coming.</p></div>;
}
