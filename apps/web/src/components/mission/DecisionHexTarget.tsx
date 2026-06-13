/** Hex frame + target crosshair (Mission Control hero), pure SVG for stable SSR. */
export function DecisionHexTarget({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M60 12L103 37V83L60 108L17 83V37L60 12Z"
        stroke="currentColor"
        strokeWidth="2"
        className="text-hx-accent"
      />
      <circle
        cx="60"
        cy="60"
        r="22"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-hx-accent"
      />
      <circle cx="60" cy="60" r="3" fill="currentColor" className="text-hx-accent" />
      <line
        x1="60"
        y1="34"
        x2="60"
        y2="48"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-hx-accent"
      />
      <line
        x1="60"
        y1="72"
        x2="60"
        y2="86"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-hx-accent"
      />
      <line
        x1="34"
        y1="60"
        x2="48"
        y2="60"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-hx-accent"
      />
      <line
        x1="72"
        y1="60"
        x2="86"
        y2="60"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-hx-accent"
      />
    </svg>
  );
}
