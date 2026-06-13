/**
 * Standalone onboarding: no app sidebar , full viewport for the setup form only.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-hide flex h-dvh max-h-dvh min-h-0 flex-col overflow-y-auto bg-hx-bg text-hx-text [background-image:radial-gradient(ellipse_85%_55%_at_50%_-8%,rgba(212,175,55,0.11),transparent_55%)]">
      {children}
    </div>
  );
}
