/** The mark the landing page uses: three discs and a square, in the gold accent. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="block" fill="#c9a45a">
      <circle cx="6.5" cy="6.5" r="4.5" />
      <circle cx="17.5" cy="6.5" r="4.5" />
      <circle cx="6.5" cy="17.5" r="4.5" />
      <rect x="13" y="13" width="9" height="9" rx="1.5" />
    </svg>
  );
}
