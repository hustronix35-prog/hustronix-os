/** Full-bleed calm strip: single line, max-width prose, no cards */
export function BreathingInterlude() {
  return (
    <section
      className="landing-zone-decision relative overflow-hidden border-y border-white/[0.05] py-28 md:py-36"
      aria-label="Pause"
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="landing-blob-purple landing-blob-drift -right-[22%] top-1/2 -translate-y-1/2" />
      </div>
      <div className="relative z-10 mx-auto max-w-prose px-6 text-center md:px-8">
        <p className="text-pretty text-lg font-medium leading-relaxed tracking-tight text-hx-text/80 md:text-xl md:leading-relaxed">
          The gap between intent and reality is not effort. It is systems.
        </p>
      </div>
    </section>
  );
}
