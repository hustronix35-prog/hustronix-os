import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Service , Hustronix",
  description: "Terms governing your use of Hustronix.",
};

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of Hustronix&apos;s services, websites, and applications (the
        &quot;Service&quot;) available at or through{" "}
        <a href="https://hustronix.online">hustronix.online</a>. By creating an
        account or using the Service, you agree to these Terms.
      </p>

      <h2>Eligibility and accounts</h2>
      <p>
        You must have the authority to enter these Terms on behalf of yourself
        or your organization. You are responsible for maintaining the
        confidentiality of your credentials and for all activity under your
        account. Notify us promptly of any unauthorized use.
      </p>

      <h2>The Service</h2>
      <p>
        Hustronix provides a decision and execution platform. Features,
        availability, and limits may change. We may modify, suspend, or
        discontinue parts of the Service with reasonable notice where
        practicable.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to misuse the Service. Without limitation, you must not:</p>
      <ul>
        <li>
          Violate applicable law or infringe others&apos; rights;
        </li>
        <li>
          Attempt to gain unauthorized access to systems, data, or accounts;
        </li>
        <li>
          Interfere with or disrupt the integrity or performance of the Service;
        </li>
        <li>
          Use the Service to distribute malware, spam, or deceptive content;
        </li>
        <li>
          Reverse engineer the Service except where such restriction is
          prohibited by law.
        </li>
      </ul>

      <h2>Customer data</h2>
      <p>
        You retain rights to data you submit to the Service. You grant us a
        license to host, process, and display that data solely to provide and
        improve the Service as described in our{" "}
        <a href="/privacy">Privacy Policy</a>. You represent that you have the
        rights needed to submit such data.
      </p>

      <h2>Fees</h2>
      <p>
        Paid plans, if applicable, are billed according to the pricing presented
        at purchase or in your order form. Taxes may apply. Failure to pay may
        result in suspension or termination.
      </p>

      <h2>Intellectual property</h2>
      <p>
        Hustronix and its licensors own all rights in the Service, branding,
        and underlying technology. Except for the limited rights expressly
        granted in these Terms, no rights are transferred to you.
      </p>

      <h2>Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE.&quot;
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, HUSTRONIX DISCLAIMS ALL
        WARRANTIES, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED,
        ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, HUSTRONIX AND ITS AFFILIATES,
        OFFICERS, EMPLOYEES, AND SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
        PROFITS, DATA, OR GOODWILL, ARISING FROM OR RELATED TO THE SERVICE OR
        THESE TERMS, WHETHER BASED ON WARRANTY, CONTRACT, TORT, OR ANY OTHER
        LEGAL THEORY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        HUSTRONIX&apos; TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING
        TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE AMOUNTS YOU PAID TO
        HUSTRONIX FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE THE EVENT
        GIVING RISE TO THE CLAIM, OR ONE HUNDRED U.S. DOLLARS (USD $100) IF NO
        FEES WERE PAID, WHICHEVER IS GREATER.
      </p>

      <h2>Indemnity</h2>
      <p>
        You will defend and indemnify Hustronix against claims arising from your
        use of the Service, your data, or your violation of these Terms, except
        to the extent caused by Hustronix&apos; willful misconduct.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate
        access for breach of these Terms or if necessary to protect the Service
        or other users. Provisions that by their nature should survive will
        survive termination.
      </p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, United
        States, excluding conflict-of-law rules, unless mandatory consumer
        protection laws in your jurisdiction require otherwise. Courts in
        Delaware (or another forum we designate in writing for enterprise
        customers) shall have exclusive jurisdiction over disputes, subject to
        mandatory arbitration or venue rules that apply to you.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these Terms by posting a revised version on this page. If
        changes are material, we will provide notice as required by law or as
        we reasonably deem appropriate. Continued use after the effective date
        constitutes acceptance of the updated Terms.
      </p>

      <h2>Contact</h2>
      <p>
        For questions about these Terms, contact{" "}
        <a href="mailto:legal@hustronix.online">legal@hustronix.online</a>.
      </p>
    </LegalPageShell>
  );
}
