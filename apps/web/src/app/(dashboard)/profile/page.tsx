import { Suspense } from "react";
import { ProfileClient } from "./ProfileClient";

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-hx-muted">Loading profile…</div>}>
      <ProfileClient />
    </Suspense>
  );
}
