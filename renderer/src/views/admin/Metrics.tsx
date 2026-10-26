/* Admin → Metrics: built to match the website. Placeholder until it is. */
export function AdminMetrics({ id }: { id?: string }) {
  return <div className="empty-state"><p>Admin Metrics{id ? ` (${id})` : ""} is coming.</p></div>;
}
