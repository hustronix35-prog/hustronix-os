"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { SetPasswordModal } from "@/components/auth/SetPasswordModal";

interface MePayload {
  userId?: string;
  hasPassword?: boolean;
  user?: { id?: string };
}

function resolveUserId(me: MePayload): string | undefined {
  const fromUser = me.user?.id;
  if (fromUser && String(fromUser).trim()) return String(fromUser).trim();
  if (me.userId && String(me.userId).trim()) return String(me.userId).trim();
  return undefined;
}

/** TEMP: skip set-password modal so Mission Control loads without the form. */
const SKIP_PASSWORD_GATE = true;

export function CredentialGate({ children }: { children: ReactNode }) {
  const [needsPassword, setNeedsPassword] = useState(false);

  const refresh = useCallback(async () => {
    if (SKIP_PASSWORD_GATE) {
      setNeedsPassword(false);
      return;
    }
    try {
      const me = await apiGet<MePayload>("/api/me");
      const uid = resolveUserId(me);
      if (!uid || uid === "system") {
        setNeedsPassword(false);
        return;
      }
      if (me.hasPassword === true) {
        setNeedsPassword(false);
        return;
      }
      if (me.hasPassword === false) {
        setNeedsPassword(true);
        return;
      }
      setNeedsPassword(false);
    } catch {
      setNeedsPassword(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onMeUpdated() {
      void refresh();
    }
    window.addEventListener("hx-me-updated", onMeUpdated);
    return () => window.removeEventListener("hx-me-updated", onMeUpdated);
  }, [refresh]);

  if (needsPassword) {
    return (
      <>
        {children}
        <SetPasswordModal />
      </>
    );
  }

  return <>{children}</>;
}
