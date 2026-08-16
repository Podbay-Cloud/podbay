import LegalDoc from "@/components/legal-doc";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      updated="August 5, 2026"
      intro="How Podbay collects, uses, and protects your information — written in plain language, and shaped by a product that is deliberately privacy-forward."
    >
      <h2>1. Who we are</h2>
      <p>
        Podbay (&ldquo;Podbay&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides cloud
        &ldquo;pods&rdquo; that run coding agents (such as Claude Code and Codex) you can reach from
        any browser. This policy covers <code>podbay.cloud</code> and the Podbay app. Podbay is
        operated by <strong>Itzhak Lobak</strong> (an individual/sole proprietor), the data
        controller. A postal address is available on request at{" "}
        <a href="mailto:privacy@podbay.cloud">privacy@podbay.cloud</a>.
      </p>

      <h2>2. Information we collect</h2>
      <p>We keep this deliberately small. We collect:</p>
      <ul>
        <li>
          <strong>Account information</strong> — when you sign in with GitHub: your email address,
          name, and GitHub account identifier.
        </li>
        <li>
          <strong>Pod &amp; usage metadata</strong> — pods you launch, their size and lifecycle
          (running/suspended), and coarse events (launched, updated, resized) so the product works
          and we can support you.
        </li>
        <li>
          <strong>Content you place in a pod</strong> — the code and files in your pod&rsquo;s
          workspace, and your conversations with the agent, live on the pod&rsquo;s persistent
          volume. We do <strong>not</strong> mine or train on them.
        </li>
        <li>
          <strong>Secrets</strong> — app secrets you set are stored <strong>encrypted</strong> and
          are write-only in the UI (never shown again). We never log or display their values.
        </li>
        <li>
          <strong>Support conversations</strong> — messages you send us through the in-app support
          chat.
        </li>
        <li>
          <strong>Product analytics</strong> — with your consent, how you use the app (pages, clicks,
          performance). Analytics are scrubbed of credential-shaped values, the terminal and secret
          inputs are excluded from any session recording, and we store the <em>domain only</em> for
          the fleet&rsquo;s fetch-memory — never a URL, never page content, never who asked.
        </li>
      </ul>

      <h2>3. How we collect it</h2>
      <p>
        Directly from you (sign-in, launching pods, entering secrets, contacting support), and
        automatically through cookies/analytics <strong>only after you consent</strong> (see our{" "}
        <a href="/cookies">Cookie Policy</a>).
      </p>

      <h2>4. How we use it</h2>
      <ul>
        <li>To provide and operate your pods and the app.</li>
        <li>To authenticate you and keep your account secure.</li>
        <li>To provide support and respond to your requests.</li>
        <li>To understand usage and improve the product (with consent).</li>
        <li>To detect, prevent, and address abuse, security, and fraud.</li>
        <li>To comply with legal obligations.</li>
      </ul>

      <h2>5. Legal basis for processing (GDPR)</h2>
      <p>
        We process account and pod data to <strong>perform our contract</strong> with you (providing
        the service), analytics on the basis of your <strong>consent</strong>, and security/abuse
        prevention on the basis of our <strong>legitimate interests</strong>. Where required, consent
        can be withdrawn at any time.
      </p>

      <h2>6. Sharing &amp; third parties (sub-processors)</h2>
      <p>We don&rsquo;t sell your personal information. We share it only with the providers we need to run the service:</p>
      <ul>
        <li><strong>Fly.io</strong> — cloud hosting for pods and the app (region: Frankfurt, EU).</li>
        <li><strong>PostHog</strong> — product analytics and support inbox (United States).</li>
        <li><strong>Anthropic</strong> and <strong>OpenAI</strong> — the coding agents (Claude / Codex) you run, generally on your own subscription/login.</li>
        <li><strong>GitHub</strong> — sign-in (OAuth) and, if you connect a repo, cloning it into your pod.</li>
      </ul>
      <p>
        Each processes data under its own terms and our agreements. When an agent runs on your own
        Anthropic/OpenAI login, your relationship with that provider is directly with them.
      </p>

      <h2>7. International data transfer</h2>
      <p>
        Pods and the app are hosted in the EU (Frankfurt); some processors (e.g. PostHog) are in the
        United States, so some data is transferred internationally. Where required, transfers rely on
        appropriate safeguards such as Standard Contractual Clauses.
      </p>

      <h2>8. Data retention</h2>
      <p>
        We keep account data while your account is active and delete it within 30 days of account
        deletion. Pod content lives on your pod&rsquo;s volume until you delete the pod. Operational
        logs are kept for up to 90 days. Coarse analytics are retained per our analytics
        provider&rsquo;s settings. We may retain limited data longer where we must for legal reasons.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Depending on where you live (EU/UK GDPR, California CCPA/CPRA, and others), you may have the
        right to access, correct, delete, port, or restrict processing of your personal data, to
        object to certain processing, and to withdraw consent. California residents may request that
        we not &ldquo;sell&rdquo; or &ldquo;share&rdquo; personal information — we do not. To exercise
        any right, email <a href="mailto:privacy@podbay.cloud">privacy@podbay.cloud</a>. You may also
        complain to your local data-protection authority.
      </p>

      <h2>10. Cookies &amp; tracking</h2>
      <p>
        We set strictly-necessary cookies for the app to work (e.g. your session and your cookie
        choice). Non-essential analytics cookies run <strong>only after you accept</strong> them in
        the consent banner. Details are in our <a href="/cookies">Cookie Policy</a>.
      </p>

      <h2>11. Security</h2>
      <p>
        We use encryption in transit, encrypted storage for secrets, access controls, and design the
        product to minimise what we collect (for example, the terminal and secret inputs are excluded
        from analytics recording, and outbound analytics are scrubbed of credential-shaped values). No
        system is perfectly secure; we cannot guarantee absolute security.
      </p>

      <h2>12. Children&rsquo;s privacy</h2>
      <p>
        Podbay is not directed to children and is not intended for anyone under 16 (or the age of
        digital consent in your country). We do not knowingly collect data from children.
      </p>

      <h2>13. Contact</h2>
      <p>
        Privacy questions or requests: <a href="mailto:privacy@podbay.cloud">privacy@podbay.cloud</a>.
        Security reports: <a href="mailto:security@podbay.cloud">security@podbay.cloud</a>.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We may update this policy; we&rsquo;ll change the &ldquo;last updated&rdquo; date and, for
        material changes, give reasonable notice. Continued use after changes take effect means you
        accept the updated policy.
      </p>

      <h2>15. Additional disclosures</h2>
      <p>
        We do not sell personal information. Third-party sites linked from Podbay have their own
        policies. Governing law and jurisdiction are set out in our <a href="/terms">Terms</a>.
      </p>
    </LegalDoc>
  );
}
