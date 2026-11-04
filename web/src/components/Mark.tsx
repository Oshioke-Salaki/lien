/** The mark: an L held down by a bar, the way a lien holds a title. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="block">
      <rect width="24" height="24" fill="#000" />
      <path d="M7 4h4v13h6v3H7z" fill="#fff" />
      <rect x="13" y="4" width="4" height="10" fill="#fe7141" />
    </svg>
  );
}
