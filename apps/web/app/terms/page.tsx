import LegalDoc from "@/components/legal-doc";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      updated="August 5, 2026"
      intro="The agreement between you and Podbay for using the service. Plain language where we can; the bolded clauses are the ones that matter most."
    >
      <h2>1. Agreement to these terms</h2>
      <p>
        By creating an account or using Podbay you agree to these Terms. If you use Podbay on behalf
        of an organisation, you confirm you&rsquo;re authorised to bind it. You must be at least 16
        (or the age of digital consent where you live). If you don&rsquo;t agree, don&rsquo;t use the
        service.
      </p>

      <h2>2. What Podbay is</h2>
      <p>
        Podbay provides cloud &ldquo;pods&rdquo; that run coding agents you can reach from a browser.
        Podbay is operated by <strong>Itzhak Lobak</strong> (an individual/sole proprietor). Podbay is
        currently in <strong>invite-only alpha</strong> and provided{" "}
        <strong>&ldquo;as is&rdquo;</strong>, without guarantees of availability, fitness, or that it
        will meet your needs. Features may change.
      </p>

      <h2>3. Your account</h2>
      <p>
        You sign in with GitHub. You&rsquo;re responsible for activity under your account and for
        keeping your credentials secure. Tell us promptly of any unauthorised use. Don&rsquo;t share
        your account.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        Podbay gives an autonomous agent a real machine that can run code and reach the internet. That
        power comes with limits. You <strong>must not</strong> use Podbay to:
      </p>
      <ul>
        <li>break the law, or infringe anyone&rsquo;s rights (including IP and privacy);</li>
        <li>
          <strong>evade access controls or scrape around a &ldquo;no&rdquo;</strong> — e.g. rotating
          IPs/agents to defeat a site&rsquo;s blocks, bulk-scraping in violation of a site&rsquo;s
          terms, or abusing the egress relay to get around a block on someone else&rsquo;s behalf.
          Podbay is for assisted research, not bulk scraping or evasion;
        </li>
        <li>
          attack, overload, or gain unauthorised access to any system (including Podbay&rsquo;s
          infrastructure, other pods, or third parties);
        </li>
        <li>send spam, malware, or run phishing, fraud, or other abusive activity;</li>
        <li>
          mine cryptocurrency, or run workloads whose purpose is to consume resources rather than do
          your own work;
        </li>
        <li>reverse-engineer, resell, or benchmark the service to build a competing product;</li>
        <li>process others&rsquo; personal data unlawfully, or upload content you have no right to.</li>
      </ul>
      <p>
        We may suspend or terminate accounts that break these rules, and we may act to protect the
        service, other users, and third parties.
      </p>

      <h2>5. Your content and data</h2>
      <p>
        <strong>Your code and data are yours.</strong> You keep all rights to the content you place in
        your pods. You grant us only the limited licence we need to host and operate the service for
        you (store it on the pod&rsquo;s volume, transmit it to run your agent, back it up). We do not
        use your pod content to train models or for advertising.
      </p>

      <h2>6. Third-party agents and services</h2>
      <p>
        The coding agents (Claude, Codex) and any repos/APIs you connect are third-party services,
        often run on <strong>your own</strong> subscription/login. Your use of them is subject to
        their terms, and <strong>we&rsquo;re not responsible</strong> for third-party services or for
        data you or your agent send to them at your direction.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        Podbay and its software, branding, and design are ours (or our licensors&rsquo;). We grant you
        a limited, non-exclusive, non-transferable licence to use the service per these Terms. You get
        no other rights.
      </p>

      <h2>8. Fees</h2>
      <p>
        The alpha is currently provided at no charge. If we introduce paid plans, we&rsquo;ll give
        notice and the applicable pricing and billing terms will apply from then.
      </p>

      <h2>9. Availability</h2>
      <p>
        We aim to keep Podbay up but offer <strong>no SLA</strong> during alpha. We may perform
        maintenance, update pod images, or change or discontinue features. Some actions (updates,
        resizes) briefly restart your pod.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Podbay is not liable for indirect, incidental,
        special, consequential, or punitive damages, or for lost data, profits, or business. Our total
        liability for any claim is limited to the greater of the fees you paid us in the prior 12
        months or a nominal amount. <strong>Nothing in these Terms excludes liability that cannot be
        excluded by law</strong> (e.g. for death, personal injury, or fraud).
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You&rsquo;ll indemnify Podbay against claims arising from your misuse of the service, your
        content, or your breach of these Terms or the law, to the extent permitted by applicable law.
      </p>

      <h2>12. Termination</h2>
      <p>
        You can stop using Podbay and delete your account at any time. We may suspend or terminate your
        access for breach, for legal reasons, or if we discontinue the service. On termination we
        delete your data within a reasonable period, except where we must retain it. Clauses that by
        their nature should survive (IP, liability, indemnity) survive termination.
      </p>

      <h2>13. Governing law &amp; disputes</h2>
      <p>
        These Terms are governed by the laws of the <strong>State of Israel</strong>, and disputes are
        subject to the exclusive jurisdiction of the competent courts of{" "}
        <strong>Tel Aviv-Yafo, Israel</strong>, without limiting any mandatory consumer protections in
        your country.
      </p>

      <h2>14. Changes to these terms</h2>
      <p>
        We may update these Terms. For material changes we&rsquo;ll give reasonable notice (and, where
        practical, at least 30 days). Continued use after the changes take effect means you accept
        them; if you disagree, stop using the service.
      </p>

      <h2>15. Miscellaneous</h2>
      <p>
        If any provision is unenforceable, the rest still applies. These Terms and our{" "}
        <a href="/privacy">Privacy Policy</a> are the entire agreement between us on this subject. We
        may assign these Terms as part of a merger or sale; you may not assign them without our
        consent. Our failure to enforce a provision isn&rsquo;t a waiver.
      </p>
    </LegalDoc>
  );
}
