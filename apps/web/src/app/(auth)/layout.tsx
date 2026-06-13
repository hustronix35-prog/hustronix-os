export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-hx-bg px-4 py-12 text-hx-text">
      <div className="w-full max-w-[420px]">{children}</div>
    </div>
  );
}
