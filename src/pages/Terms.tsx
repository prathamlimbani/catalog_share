import LegalPage, {
  LegalHeading,
  LegalItem,
  LegalList,
  LegalNote,
  LegalStrong,
  LegalText,
} from "@/components/LegalPage";

/**
 * /terms — the full Terms & Conditions.
 *
 * Replaces the five-paragraph stub that predated the Play release. The mirror
 * at /legal/terms.html carries the same text for reviewers who cannot install
 * the app.
 */
const Terms = () => {
  return (
    <LegalPage title="Terms & Conditions" effectiveDate="19 August 2026" lastUpdated="19 August 2026">
      <LegalText>
        These Terms &amp; Conditions govern your use of CatalogShare &mdash; the Android app (Google
        Play package <LegalStrong>in.catalogshare.app</LegalStrong>), the website at{" "}
        <LegalStrong>https://catalogshare.online</LegalStrong>, the public storefront pages we host for
        you, and every related service. Please read them before you create an account.
      </LegalText>

      <LegalHeading>1. Acceptance of these terms</LegalHeading>
      <LegalText>
        By creating an account, installing the app, or using any part of CatalogShare, you agree to be
        bound by these terms and by our Privacy Policy and Refund Policy, which form part of this
        agreement. If you do not agree, do not use CatalogShare. If you are accepting on behalf of a
        business, you confirm you are authorised to bind that business, and &ldquo;you&rdquo; means both
        you and that business.
      </LegalText>

      <LegalHeading>2. Eligibility</LegalHeading>
      <LegalList>
        <LegalItem>You must be at least 18 years old.</LegalItem>
        <LegalItem>
          You must be operating a genuine business, trade or profession. CatalogShare is a business
          tool; it is not intended for personal or consumer use.
        </LegalItem>
        <LegalItem>
          You must be legally able to enter a binding contract under the Indian Contract Act, 1872, and
          not be barred from receiving services under any applicable law.
        </LegalItem>
        <LegalItem>
          You must give accurate registration details, including a working business email and phone
          number, and keep them current.
        </LegalItem>
      </LegalList>

      <LegalHeading>3. What CatalogShare provides</LegalHeading>
      <LegalText>CatalogShare lets a business:</LegalText>
      <LegalList>
        <LegalItem>build a product catalogue with names, prices, categories, descriptions and images;</LegalItem>
        <LegalItem>publish that catalogue as a public storefront page with its own link and QR code;</LegalItem>
        <LegalItem>receive enquiries and orders from customers, including over WhatsApp;</LegalItem>
        <LegalItem>
          create estimates and invoices, download them as PDFs and share them &mdash; on eligible plans;
        </LegalItem>
        <LegalItem>view basic analytics on storefront and product views;</LegalItem>
        <LegalItem>work offline, with estimates stored on the device and synced when the connection returns.</LegalItem>
      </LegalList>
      <LegalText>
        We may add, change, suspend or withdraw features at any time. Where a change materially reduces
        a feature you are currently paying for, we will give you reasonable notice.
      </LegalText>

      <LegalHeading>4. Your account</LegalHeading>
      <LegalList>
        <LegalItem>
          You are responsible for keeping your password and login codes confidential, and for everything
          done through your account.
        </LegalItem>
        <LegalItem>
          One account is for one business. Do not share credentials with people outside your business,
          and do not sell, rent or transfer your account.
        </LegalItem>
        <LegalItem>
          Tell us immediately at catalogshare123@gmail.com if you suspect unauthorised access.
        </LegalItem>
        <LegalItem>
          We may require email or phone verification before enabling certain features.
        </LegalItem>
      </LegalList>

      <LegalHeading>5. Acceptable use and prohibited content</LegalHeading>
      <LegalText>You agree not to use CatalogShare to:</LegalText>
      <LegalList>
        <LegalItem>
          list, promote or sell anything unlawful in India &mdash; including narcotics, weapons,
          wildlife products, counterfeit or smuggled goods, prescription medicines sold without
          authorisation, tobacco or alcohol where prohibited, or any restricted item you are not
          licensed to sell;
        </LegalItem>
        <LegalItem>
          upload sexual, obscene, hateful, defamatory, harassing, or violent material, or content that
          exploits or endangers children;
        </LegalItem>
        <LegalItem>
          infringe anyone&rsquo;s copyright, trademark, design or other intellectual property, including
          using product photographs or brand names you have no right to use;
        </LegalItem>
        <LegalItem>
          mislead customers about prices, taxes, availability, origin, warranty, or the identity of your
          business;
        </LegalItem>
        <LegalItem>
          send spam or unsolicited bulk messages, or upload contact lists you have no consent to use;
        </LegalItem>
        <LegalItem>
          upload malware, attempt to breach our security, probe or scan our systems, bypass plan limits
          or the ad system, scrape the platform in bulk, or reverse engineer the app except where the
          law expressly allows it;
        </LegalItem>
        <LegalItem>
          impersonate CatalogShare, another business, or any person, or use our name and logo without
          written permission.
        </LegalItem>
      </LegalList>
      <LegalText>
        We may remove content that breaches this section, and suspend or terminate accounts that do,
        without refund.
      </LegalText>

      <LegalHeading>6. Your content, and your customers&rsquo; data</LegalHeading>
      <LegalText>
        You keep ownership of everything you upload: your catalogue, images, logo, company details and
        estimates. You grant CatalogShare a non-exclusive, worldwide, royalty-free licence to host,
        store, reproduce, resize and display that content for the sole purpose of operating the service
        for you &mdash; for example, rendering your public storefront and generating your PDFs. This
        licence ends when you delete the content or your account.
      </LegalText>
      <LegalNote>
        You are solely responsible for the accuracy of your catalogue, prices, tax rates, estimates and
        invoices. CatalogShare formats the document; it does not verify your figures, your GST treatment
        or your legal compliance. Check every estimate before you send it.
      </LegalNote>
      <LegalText>
        When you enter a customer&rsquo;s name, phone number or address into an estimate, you are the
        data controller (data fiduciary) for that information and CatalogShare acts only as your
        processor. You confirm that you have a lawful basis to collect and store that data, that you
        have told your customers how it will be used, and that you will handle deletion or correction
        requests they make to you. You indemnify us against claims arising from your handling of your
        customers&rsquo; data.
      </LegalText>

      <LegalHeading>7. Intellectual property in the platform</LegalHeading>
      <LegalText>
        CatalogShare, its name, logo, software, design, interface and documentation belong to us and are
        protected by copyright, trademark and other laws. You get a limited, non-exclusive,
        non-transferable, revocable licence to use the app and website for your own business while your
        account is in good standing. You may not copy, modify, distribute, sell, sublicense, or create
        derivative works of any part of the platform.
      </LegalText>

      <LegalHeading>8. Plans, payment and the 30-day model</LegalHeading>
      <LegalNote>
        Paid plans are a <LegalStrong>one-time 30-day charge</LegalStrong>, not an auto-renewing
        subscription. No mandate or standing instruction is created on your card or UPI id, nothing is
        auto-debited, and the plan simply lapses after 30 days unless you choose to pay again.
      </LegalNote>
      <LegalList>
        <LegalItem>
          Current plans and prices are shown on the pricing page and at checkout, in Indian Rupees.
        </LegalItem>
        <LegalItem>
          Payments are collected by <LegalStrong>Razorpay</LegalStrong>. Their terms apply to the
          payment itself. We do not receive or store your card, UPI or netbanking credentials.
        </LegalItem>
        <LegalItem>
          Access unlocks as soon as the payment is confirmed and expires 30 days later. To continue, you
          make a fresh payment.
        </LegalItem>
        <LegalItem>
          When a plan lapses, the account reverts to the free plan. Data is retained; paid features
          lock. Products above the free limit are hidden, not deleted.
        </LegalItem>
        <LegalItem>
          Cancelling means not renewing. There is no cancellation fee. Refunds are governed by our
          Refund Policy.
        </LegalItem>
        <LegalItem>
          We may change prices at any time; a change never affects a period you have already paid for.
        </LegalItem>
      </LegalList>

      <LegalHeading>9. Free trial</LegalHeading>
      <LegalText>
        New accounts get a limited free trial of the estimate generator so you can evaluate it before
        paying. The trial is time-limited, offered once per business, and may be varied or withdrawn at
        our discretion. When it ends the estimate features lock until you buy an eligible plan &mdash;
        no payment is taken automatically and no card details are collected to start the trial.
        Estimates created during the trial are retained on your account.
      </LegalText>

      <LegalHeading>10. Advertising on the free tier</LegalHeading>
      <LegalText>
        The free plan is funded by advertising. Free-tier users see banner and occasional interstitial
        ads served by <LegalStrong>Google AdMob</LegalStrong>, which collects the Android Advertising ID
        and related device signals as described in our Privacy Policy.{" "}
        <LegalStrong>Paid subscribers see no ads at all</LegalStrong> and no ad requests are made for
        them. You must not block, obscure, spoof or automate interaction with ads while using the free
        plan. Advertisements do not constitute an endorsement by CatalogShare of any advertised product
        or advertiser.
      </LegalText>

      <LegalHeading>11. Third-party services</LegalHeading>
      <LegalText>
        CatalogShare relies on third parties &mdash; Supabase for database, storage and authentication,
        Razorpay for payments, Google AdMob and Google Analytics for advertising and measurement, Resend
        for transactional email, and Vercel for web hosting &mdash; and integrates with WhatsApp for
        sharing. Their own terms and privacy policies apply to their part of the service. We are not
        responsible for outages, changes or acts of these providers, or of WhatsApp, which are outside
        our control.
      </LegalText>

      <LegalHeading>12. Disclaimer of warranties</LegalHeading>
      <LegalText>
        CatalogShare is provided <LegalStrong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</LegalStrong>.
        To the fullest extent permitted by law we disclaim all warranties, express or implied, including
        merchantability, fitness for a particular purpose and non-infringement. We do not warrant that
        the service will be uninterrupted, error-free or secure, that stored data will never be lost,
        that estimates or tax calculations will be correct for your circumstances, or that using
        CatalogShare will generate sales or enquiries. CatalogShare is not accounting, tax or legal
        advice. Keep your own backups of anything critical &mdash; the app provides CSV and PDF export
        for exactly that.
      </LegalText>

      <LegalHeading>13. Limitation of liability</LegalHeading>
      <LegalText>
        To the fullest extent permitted by law, CatalogShare and its owners, employees and suppliers are
        not liable for indirect, incidental, special, consequential or punitive damages, or for loss of
        profits, revenue, goodwill, business opportunity or data, arising from or connected with your
        use of or inability to use the service, however caused.
      </LegalText>
      <LegalText>
        Our total aggregate liability for all claims relating to the service in any 12-month period is
        limited to the amount you actually paid CatalogShare in the 3 months immediately before the
        event giving rise to the claim, or &#8377;1,000, whichever is greater. Nothing here limits
        liability that cannot be excluded under Indian law, including liability for fraud.
      </LegalText>

      <LegalHeading>14. Indemnity</LegalHeading>
      <LegalText>
        You agree to indemnify and hold CatalogShare harmless from any claim, demand, loss, liability,
        penalty or expense (including reasonable legal fees) arising from: your content; your products
        or services and any dispute with your customers; your handling of your customers&rsquo; personal
        data; your breach of these terms or of any law; or any misuse of your account.
      </LegalText>

      <LegalHeading>15. Suspension and termination</LegalHeading>
      <LegalList>
        <LegalItem>
          You may stop using CatalogShare at any time, and may delete your account permanently from the
          Account Deletion page.
        </LegalItem>
        <LegalItem>
          We may suspend or terminate your account, with notice where practical, if you breach these
          terms, if your content is unlawful, if we are required to by law or a court, or if your use
          threatens the security or integrity of the platform or other users.
        </LegalItem>
        <LegalItem>
          For serious breaches &mdash; unlawful content, fraud, attacks on our systems &mdash; we may
          act immediately and without refund.
        </LegalItem>
        <LegalItem>
          On termination your storefront stops being served and your licence to use the platform ends.
          Sections on content ownership, intellectual property, disclaimers, liability, indemnity and
          governing law survive.
        </LegalItem>
      </LegalList>

      <LegalHeading>16. Changes to these terms</LegalHeading>
      <LegalText>
        We may revise these terms as the product and the law change. The effective date at the top shows
        the current version. For material changes we will notify you in the app or by email before they
        take effect. Continuing to use CatalogShare after the effective date means you accept the revised
        terms; if you do not accept them, stop using the service and delete your account.
      </LegalText>

      <LegalHeading>17. Governing law and jurisdiction</LegalHeading>
      <LegalText>
        These terms are governed by the laws of India. The courts of Gujarat, India have exclusive
        jurisdiction over any dispute arising out of or relating to these terms or your use of
        CatalogShare, and you consent to that jurisdiction. Before starting proceedings, please contact
        us &mdash; most issues are settled in a single email.
      </LegalText>

      <LegalHeading>18. General</LegalHeading>
      <LegalList>
        <LegalItem>
          If any provision is held unenforceable, the rest of these terms continue in full force.
        </LegalItem>
        <LegalItem>
          Our failure to enforce a provision is not a waiver of it.
        </LegalItem>
        <LegalItem>
          You may not assign this agreement. We may assign it as part of a merger, acquisition or sale
          of assets.
        </LegalItem>
        <LegalItem>
          These terms, with the Privacy Policy and Refund Policy, are the entire agreement between you
          and CatalogShare regarding the service.
        </LegalItem>
      </LegalList>

      <LegalHeading>19. Contact</LegalHeading>
      <LegalText>
        CatalogShare, Gujarat, India. Email <LegalStrong>catalogshare123@gmail.com</LegalStrong>,
        website <LegalStrong>https://catalogshare.online</LegalStrong>.
      </LegalText>
    </LegalPage>
  );
};

export default Terms;
