import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy , Hustronix",
  description: "How Hustronix collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy">
      <p>
        This Privacy Policy describes how Hustronix (&quot;we,&quot;
        &quot;us,&quot; or &quot;our&quot;) handles personal information when
        you use our services at{" "}
        <a href="https://hustronix.online">hustronix.online</a> and related
        products (the &quot;Service&quot;). By using the Service, you agree to
        this policy.
      </p>

      <h2>Information we collect</h2>
      <p>We may collect the following categories of information:</p>
      <ul>
        <li>
          <strong>Account and profile data</strong> , name, email address,
          organization details, and preferences you provide when you register
          or update your profile.
        </li>
        <li>
          <strong>Usage and product data</strong> , how you interact with the
          Service, including decisions, signals, execution records, chat
          history, and settings you store in the product.
        </li>
        <li>
          <strong>Technical data</strong> , device type, browser, approximate
          location derived from IP, timestamps, and diagnostic logs needed to
          operate and secure the platform.
        </li>
        <li>
          <strong>Communications</strong> , messages you send to us (for example
          support requests) and related metadata.
        </li>
      </ul>

      <h2>How we use information</h2>
      <p>We use personal information to:</p>
      <ul>
        <li>Provide, maintain, and improve the Service;</li>
        <li>Authenticate users, prevent fraud, and enforce security;</li>
        <li>Communicate about the Service, including operational notices;</li>
        <li>Comply with law and respond to lawful requests;</li>
        <li>
          Analyze aggregate or de-identified usage to improve product
          experience, where permitted.
        </li>
      </ul>

      <h2>Cookies and similar technologies</h2>
      <p>
        We use cookies and similar technologies for session management,
        authentication, preferences, and analytics. You can control cookies
        through your browser settings. For more detail, see our{" "}
        <a href="/cookies">Cookie Policy</a>.
      </p>

      <h2>Third parties</h2>
      <p>
        We may use subprocessors and service providers (for example hosting,
        analytics, or email delivery) that process data on our behalf under
        contractual obligations. We do not sell your personal information.
        Where we rely on third-party integrations you enable, those providers
        may process data according to their own policies.
      </p>

      <h2>Retention</h2>
      <p>
        We retain information for as long as your account is active or as
        needed to provide the Service, comply with legal obligations, resolve
        disputes, and enforce our agreements. Retention periods may vary by
        data type and jurisdiction.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct,
        delete, or export your personal information, or to object to or
        restrict certain processing. You may also withdraw consent where
        processing is consent-based. To exercise these rights, contact us using
        the details below. You may lodge a complaint with your local data
        protection authority.
      </p>

      <h2>Security</h2>
      <p>
        We implement technical and organizational measures designed to protect
        personal information. No method of transmission or storage is
        completely secure; we encourage you to use strong passwords and protect
        your account credentials.
      </p>

      <h2>International transfers</h2>
      <p>
        If you access the Service from outside the country where we operate
        servers, your information may be processed in other countries. We take
        steps designed to ensure appropriate safeguards where required by law.
      </p>

      <h2>Children</h2>
      <p>
        The Service is not directed to children under 16, and we do not
        knowingly collect their personal information.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. We will post the
        revised policy on this page and update the &quot;Last updated&quot;
        date.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, contact us at{" "}
        <a href="mailto:privacy@hustronix.online">privacy@hustronix.online</a>
        .
      </p>
    </LegalPageShell>
  );
}
