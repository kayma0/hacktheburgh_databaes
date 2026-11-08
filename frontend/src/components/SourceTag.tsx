/** "Sourced" or "Assumption" next to a number, with the source on hover. */
export default function SourceTag({ assumed, title }: { assumed: boolean; title?: string }) {
  if (assumed) return null; // the orange "Assumption" pills were removed from the UI
  return (
    <span className={`src-tag ${assumed ? "is-assumed" : ""}`} title={title}>
      {assumed ? "Assumption" : "Sourced"}
    </span>
  );
}
