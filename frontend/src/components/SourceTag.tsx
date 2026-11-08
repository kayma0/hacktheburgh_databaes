/** "Sourced" or "Assumption" next to a number, with the source on hover. */
export default function SourceTag({ assumed, title }: { assumed: boolean; title?: string }) {
  return (
    <span className={`src-tag ${assumed ? "is-assumed" : ""}`} title={title}>
      {assumed ? "Assumption" : "Sourced"}
    </span>
  );
}
