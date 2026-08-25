import { redirect } from "next/navigation";

/** Integrations live under Settings — keep this route as a soft redirect. */
export default function BrainIntegrationsRedirect() {
  redirect("/settings/integrations");
}
