import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Cookie Policy , Hustronix",
  description: "How Hustronix uses cookies and similar technologies.",
};

export default function CookiesPage() {
  return (
    <LegalPageShell title="Cookie Policy">
      <p>
        This Cookie Policy explains how Hustronix (&quot;we,&quot; &quot;us,&quot;
        or &quot;our&quot;) uses cookies and similar technologies on{" "}
        <a href="https://hustronix.online">hustronix.online</a> and our web
        applications (together, the &quot;Sites&quot;). It should be read with
        our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>What are cookies?</h2>
      <p>
        Cookies are small text files placed on your device when you visit a
        website. Similar technologies include local storage, session storage, and
        pixels. They help us recognize your browser, maintain sessions, and
        understand how the Sites are used.
      </p>

      <h2>How we use cookies</h2>
      <p>We use cookies and similar technologies for purposes such as:</p>
      <ul>
        <li>
          <strong>Strictly necessary</strong> , authentication, security,
          load balancing, and core functionality. These are required for the
          Service to work.
        </li>
        <li>
          <strong>Preferences</strong> , remembering your settings (for example
          theme or locale) where applicable.
        </li>
        <li>
          <strong>Analytics</strong> , understanding usage patterns in aggregate
          to improve performance and product design.
        </li>
      </ul>

      <h2>Third-party cookies</h2>
      <p>
        Some cookies may be set by analytics or infrastructure providers we use
        to operate the Service. Those providers are instructed to process data
        in line with our agreements and applicable law.
      </p>

      <h2>Your choices</h2>
      <p>
        Most browsers let you refuse or delete cookies. If you block strictly
        necessary cookies, parts of the Service (including sign-in) may not
        function. You can also use browser or device settings to clear stored
        data.
      </p>

      <h2>Do Not Track</h2>
      <p>
        There is no consistent industry standard for &quot;Do Not Track&quot;
        signals. We process personal information as described in our Privacy
        Policy regardless of such signals, unless required otherwise by law.
      </p>

      <h2>Updates</h2>
      <p>
        We may update this Cookie Policy from time to time. The &quot;Last
        updated&quot; date at the top of this page will change when we do.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about cookies or this policy:{" "}
        <a href="mailto:privacy@hustronix.online">privacy@hustronix.online</a>.
      </p>
    </LegalPageShell>
  );
}
