/* Admin → Roadmap: built to match the website. Placeholder until it is. */
export function AdminRoadmap({ id }: { id?: string }) {
  return <div className="empty-state"><p>Admin Roadmap{id ? ` (${id})` : ""} is coming.</p></div>;
}
