export function HustrionixLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M24 4L41 14V34L24 44L7 34V14L24 4Z"
        stroke="currentColor"
        strokeWidth="1.25"
        className="text-hx-text"
      />
      <path
        d="M18 16V32M30 16V32M18 24H30"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-hx-text"
      />
      <line
        x1="24"
        y1="14"
        x2="24"
        y2="34"
        stroke="var(--hx-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="24" cy="14" r="2" fill="var(--hx-accent)" />
      <circle cx="24" cy="24" r="2" fill="var(--hx-accent)" />
      <circle cx="24" cy="34" r="2" fill="var(--hx-accent)" />
    </svg>
  );
}
