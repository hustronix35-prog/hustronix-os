"use client";

/** Abstract nodes + weak links , “nothing breaks until everything does” */
export function InstabilityStrip() {
  return (
    <div className="mx-auto mt-12 max-w-md" aria-hidden>
      <svg
        viewBox="0 0 320 88"
        className="w-full text-landing-gold"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="instability-line"
          d="M40 44 H120"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
        />
        <path
          className="instability-line"
          style={{ animationDelay: "0.4s" }}
          d="M200 44 H280"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
        />
        <path
          d="M120 44 L160 28 L200 44"
          stroke="currentColor"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
        <circle
          className="instability-node"
          cx={40}
          cy={44}
          r={5}
          stroke="currentColor"
          strokeOpacity={0.65}
          strokeWidth={1.2}
        />
        <circle
          className="instability-node"
          cx={160}
          cy={28}
          r={6}
          stroke="currentColor"
          strokeOpacity={0.85}
          strokeWidth={1.4}
          fill="rgba(198,168,90,0.08)"
        />
        <circle
          className="instability-node"
          cx={280}
          cy={44}
          r={5}
          stroke="currentColor"
          strokeOpacity={0.65}
          strokeWidth={1.2}
        />
      </svg>
    </div>
  );
}
