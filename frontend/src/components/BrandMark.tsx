/** The SickleSignal logo: a blood drop with two signal arcs above it. */
export default function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="60 60 1056 880" aria-hidden>
      <path d="M85 318Q588-152 1091 318Q588 32 85 318Z" fill="#F0AAB4" />
      <path d="M202 417Q588 57 973 417Q588 211 202 417Z" fill="#E5667A" />
      <path d="M588 377L430 650A183 183 0 1 0 746 650Z" fill="#D81F3A" />
    </svg>
  );
}
