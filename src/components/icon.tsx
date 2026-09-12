export function Icon({
  name,
  className = "",
  size = 18,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={`material-symbols-outlined shrink-0 ${className}`}
      style={{ fontSize: size }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
