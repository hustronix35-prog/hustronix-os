import { CredentialGate } from "@/components/auth/CredentialGate";
import { ProductTourProviderGate } from "@/components/tour/ProductTourProviderGate";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { OnboardingGate } from "@/components/shell/OnboardingGate";
import { ApiHealthBanner } from "@/components/system/ApiHealthBanner";
import { ToastProvider } from "@/components/ui/toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div
        className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-hx-bg text-hx-text"
        suppressHydrationWarning
      >
        <ApiHealthBanner />
        <div
          className="flex min-h-0 flex-1 flex-row overflow-hidden"
          suppressHydrationWarning
        >
          <AppSidebar />
          <OnboardingGate>
            <ProductTourProviderGate>
              <CredentialGate>
                <div className="hx-dashboard-canvas scrollbar-hide relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-hx-bg">
                  <div className="flex h-full min-h-full min-w-0 w-full flex-1 flex-col">
                    {children}
                  </div>
                </div>
              </CredentialGate>
            </ProductTourProviderGate>
          </OnboardingGate>
        </div>
      </div>
    </ToastProvider>
  );
}
