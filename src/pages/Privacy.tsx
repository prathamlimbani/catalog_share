import LegalPage, {
  LegalHeading,
  LegalItem,
  LegalLink,
  LegalList,
  LegalNote,
  LegalStrong,
  LegalSubHeading,
  LegalText,
} from "@/components/LegalPage";

/**
 * /privacy — the disclosure Google Play links to from the store listing.
 * The mirror at /legal/privacy.html must be kept in step with this file: Play
 * Console reviews the standalone URL, signed-in users read this one.
 */
const Privacy = () => {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="19 August 2026" lastUpdated="19 August 2026">
      <LegalText>
        This Privacy Policy explains what CatalogShare collects when you use the CatalogShare Android
        app or the website at catalogshare.online, why we collect it, who we share it with and what
        control you have over it. CatalogShare is a catalogue, storefront and estimate tool sold to
        businesses in India.
      </LegalText>

      <LegalHeading>1. Who we are</LegalHeading>
      <LegalText>
        CatalogShare (&ldquo;CatalogShare&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates the
        CatalogShare app (Google Play package <LegalStrong>in.catalogshare.app</LegalStrong>) and the
        website <LegalStrong>https://catalogshare.online</LegalStrong>. We are based in Gujarat, India.
        You can reach us at <LegalStrong>catalogshare123@gmail.com</LegalStrong> or{" "}
        <LegalStrong>+91 76250 25686</LegalStrong>.
      </LegalText>

      <LegalHeading>2. Two different roles</LegalHeading>
      <LegalText>
        CatalogShare handles two kinds of data, and our responsibility differs for each.
      </LegalText>
      <LegalList>
        <LegalItem>
          <LegalStrong>Your business account data.</LegalStrong> We decide how this is used, so we are
          the data fiduciary (controller) for it.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your customers&rsquo; data.</LegalStrong> When you type a customer name, phone
          number and address into an estimate, <LegalStrong>you</LegalStrong> are the data fiduciary for
          that information. We only store and process it on your instructions, as your processor. You
          are responsible for having a lawful basis to collect it and for telling your customers how you
          use it.
        </LegalItem>
      </LegalList>

      <LegalHeading>3. What we collect</LegalHeading>

      <LegalSubHeading>3.1 Account and business information</LegalSubHeading>
      <LegalText>
        Collected when you register and whenever you edit your company profile: business email address,
        password, phone number, company name, business address, GST number, UPI id, company logo image,
        UPI QR code image, and your public store slug (the address of your storefront page). Your
        password is hashed by Supabase Auth before storage &mdash; we never see, store or transmit it in
        readable form.
      </LegalText>

      <LegalSubHeading>3.2 Customer information you enter</LegalSubHeading>
      <LegalText>
        When you create an estimate or invoice we store the customer name, customer phone number,
        customer address, the line items you added, quantities, prices, tax percentages, discounts and
        any notes you type. This data reaches us from you, not from your customer directly.
      </LegalText>

      <LegalSubHeading>3.3 Product catalogue</LegalSubHeading>
      <LegalText>
        Product names, prices, categories, descriptions and the product images you upload. Your
        catalogue is published on a public storefront page by design &mdash; anyone with the link can
        see it.
      </LegalText>

      <LegalSubHeading>3.4 Payment records</LegalSubHeading>
      <LegalText>
        Payments are collected by <LegalStrong>Razorpay</LegalStrong>. CatalogShare never receives or
        stores your card number, CVV, UPI PIN, netbanking credentials or any other payment credential.
        What we keep is the Razorpay payment id, the Razorpay order id, the amount, the plan purchased,
        the payment status and the plan expiry date.
      </LegalText>

      <LegalSubHeading>3.5 Usage and analytics</LegalSubHeading>
      <LegalText>
        We write events to an <LegalStrong>analytics_events</LegalStrong> table so you can see how your
        storefront is performing. Each event records the event type (page view or product view), the
        page path, the company id, the product id where relevant, a hashed form of the visitor IP
        address (we do not store plain IP addresses), the browser user-agent string and a timestamp. The
        website additionally runs <LegalStrong>Google Analytics</LegalStrong> (gtag) under property{" "}
        <LegalStrong>G-25W133Z9E9</LegalStrong>.
      </LegalText>

      <LegalSubHeading>3.6 Advertising identifiers</LegalSubHeading>
      <LegalText>
        The Android app shows Google AdMob ads to users on the{" "}
        <LegalStrong>free tier only</LegalStrong>. For those users the AdMob SDK collects the{" "}
        <LegalStrong>Android Advertising ID (AAID)</LegalStrong> and related device signals. Section 5
        covers this in full.
      </LegalText>

      <LegalSubHeading>3.7 Device storage</LegalSubHeading>
      <LegalText>
        Estimates you create are also written to{" "}
        <LegalStrong>IndexedDB on your own device</LegalStrong> so the app keeps working with no
        network, and are synced to our servers once you are online again. We also store small
        preferences (theme, selected skin, pending sync queue) and your login session token locally
        &mdash; in Android SharedPreferences in the app, in localStorage on the web.
      </LegalText>

      <LegalHeading>4. Why we use it, and our legal basis</LegalHeading>
      <LegalList>
        <LegalItem>
          <LegalStrong>To run the service</LegalStrong> &mdash; create your account, publish your
          storefront, generate estimates and PDFs, sync offline data. Basis: performance of our contract
          with you.
        </LegalItem>
        <LegalItem>
          <LegalStrong>To take payment and manage your plan</LegalStrong> &mdash; process the charge,
          unlock features, expire the plan after 30 days. Basis: performance of contract and legal
          obligation.
        </LegalItem>
        <LegalItem>
          <LegalStrong>To support you</LegalStrong> &mdash; answer emails and calls, investigate faults.
          Basis: legitimate interest and performance of contract.
        </LegalItem>
        <LegalItem>
          <LegalStrong>To show you storefront analytics and improve the product</LegalStrong> &mdash;
          aggregate view counts, error and crash patterns. Basis: legitimate interest.
        </LegalItem>
        <LegalItem>
          <LegalStrong>To show ads on the free tier</LegalStrong> &mdash; this funds the free plan.
          Basis: consent, collected through the Google-provided consent form where required and
          withdrawable at any time (see section 5).
        </LegalItem>
        <LegalItem>
          <LegalStrong>To keep records the law requires</LegalStrong> &mdash; invoices, tax and payment
          records. Basis: legal obligation under Indian tax and company law.
        </LegalItem>
      </LegalList>

      <LegalHeading>5. Advertising and the Android Advertising ID</LegalHeading>
      <LegalNote>
        Paid subscribers see no ads at all. While your plan is active the app makes no ad requests, so
        no advertising identifier is read or transmitted for you.
      </LegalNote>
      <LegalText>
        For free-tier users the app displays banner and occasional interstitial ads served by{" "}
        <LegalStrong>Google AdMob</LegalStrong>. To serve, frequency-cap and measure those ads, the
        Google Mobile Ads SDK collects the Android Advertising ID (a resettable identifier assigned by
        your device), approximate location derived from your IP address, device model, operating system
        version and ad interaction data. CatalogShare does not receive this identifier and does not link
        it to your business account.
      </LegalText>
      <LegalText>
        Google&rsquo;s use of this data is governed by the{" "}
        <LegalLink href="https://policies.google.com/technologies/partner-sites">
          Google privacy and terms for partner sites
        </LegalLink>{" "}
        and the{" "}
        <LegalLink href="https://business.safety.google/privacy/">
          Google business data privacy notice
        </LegalLink>
        . A plain-language list of what AdMob collects is at{" "}
        <LegalLink href="https://support.google.com/admob/answer/6128543">
          support.google.com/admob/answer/6128543
        </LegalLink>
        .
      </LegalText>
      <LegalText>
        You control this in two places. In the app, open <LegalStrong>Settings</LegalStrong> and use{" "}
        <LegalStrong>Ad privacy options</LegalStrong> to change or withdraw your advertising consent. On
        the device, go to <LegalStrong>Android Settings &rarr; Privacy &rarr; Ads</LegalStrong> to reset
        or delete your Advertising ID. Upgrading to any paid plan removes ads entirely.
      </LegalText>

      <LegalHeading>6. Who we share it with</LegalHeading>
      <LegalText>
        We do not sell your personal data and we do not share it with advertisers or data brokers. We
        use the following sub-processors, each bound to use the data only to provide their service to
        us:
      </LegalText>
      <LegalList>
        <LegalItem>
          <LegalStrong>Supabase</LegalStrong> &mdash; database, file storage and authentication. Holds
          your account, catalogue, estimates, uploaded images and analytics rows.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Razorpay</LegalStrong> &mdash; payment processing for every plan purchase.
          Receives your name, email, phone and payment instrument details directly from you.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Google AdMob</LegalStrong> &mdash; advertising, free tier only.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Google Analytics</LegalStrong> &mdash; website traffic measurement (property
          G-25W133Z9E9).
        </LegalItem>
        <LegalItem>
          <LegalStrong>Resend</LegalStrong> &mdash; sending transactional email such as verification
          codes, password resets and order notifications.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Vercel</LegalStrong> &mdash; hosting and content delivery for the website.
        </LegalItem>
      </LegalList>
      <LegalText>
        We will also disclose data where we are legally required to &mdash; a court order, or a valid
        request from a law-enforcement or tax authority &mdash; and to our professional advisers where
        necessary. If CatalogShare is ever sold or merged, your data may transfer to the acquirer under
        this same policy, and we will tell you before that happens.
      </LegalText>

      <LegalHeading>7. International transfers</LegalHeading>
      <LegalText>
        Our sub-processors operate global infrastructure, so your data may be stored or processed on
        servers outside India. Where that happens we rely on the provider&rsquo;s contractual data
        protection commitments, including standard contractual clauses where applicable, and we do not
        transfer data to any territory restricted under Indian law.
      </LegalText>

      <LegalHeading>8. How long we keep it</LegalHeading>
      <LegalList>
        <LegalItem>
          <LegalStrong>Account, catalogue and estimate data</LegalStrong> &mdash; for as long as your
          account exists. Deleted immediately on account deletion, and purged from encrypted backups
          within 30 days.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Payment and tax records</LegalStrong> &mdash; retained after deletion for the
          statutory period required by Indian tax and company law (currently up to eight years), in a
          reduced anonymised form: payment id, amount, plan and date, with the account identity
          stripped.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Analytics events</LegalStrong> &mdash; retained for up to 24 months, then
          deleted.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Support correspondence</LegalStrong> &mdash; retained for up to 24 months from
          the last message.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Data stored on your device</LegalStrong> &mdash; stays there until you clear the
          app data, sign out, or uninstall the app.
        </LegalItem>
      </LegalList>

      <LegalHeading>9. How we protect it</LegalHeading>
      <LegalList>
        <LegalItem>All traffic between the app, the website and our servers uses HTTPS/TLS.</LegalItem>
        <LegalItem>Data at rest is encrypted by our infrastructure provider.</LegalItem>
        <LegalItem>
          Passwords are salted and hashed by Supabase Auth. Password resets use one-time codes that
          expire.
        </LegalItem>
        <LegalItem>
          Row Level Security is enabled on our database tables, so one merchant cannot read another
          merchant&rsquo;s account, catalogue or estimates.
        </LegalItem>
        <LegalItem>
          Privileged service-role keys exist only inside server-side edge functions and are never
          shipped in the app.
        </LegalItem>
        <LegalItem>
          On Android your session token is kept in app-private SharedPreferences rather than WebView
          storage.
        </LegalItem>
      </LegalList>
      <LegalText>
        No system is perfectly secure. If a breach affects your personal data we will notify you and the
        Data Protection Board of India as required by law.
      </LegalText>

      <LegalHeading>10. Children</LegalHeading>
      <LegalText>
        CatalogShare is a business tool. It is not directed at children, and we do not knowingly collect
        personal data from anyone under 18. You must be 18 or older to open an account. If you believe a
        child has given us personal data, email catalogshare123@gmail.com and we will delete it.
      </LegalText>

      <LegalHeading>11. Your rights</LegalHeading>
      <LegalText>
        Under the Digital Personal Data Protection Act, 2023 and other applicable law you may:
      </LegalText>
      <LegalList>
        <LegalItem>ask what personal data we hold about you and obtain a copy of it;</LegalItem>
        <LegalItem>correct or complete anything inaccurate;</LegalItem>
        <LegalItem>have your data erased, by deleting your account;</LegalItem>
        <LegalItem>
          export your catalogue, estimates and analytics &mdash; the app has built-in CSV and PDF
          export;
        </LegalItem>
        <LegalItem>withdraw a consent you gave, such as advertising consent;</LegalItem>
        <LegalItem>
          nominate another person to exercise these rights if you die or become incapacitated;
        </LegalItem>
        <LegalItem>complain to us, and then to the Data Protection Board of India.</LegalItem>
      </LegalList>
      <LegalText>
        To exercise any of these, edit your details in the app, use the deletion flow described below,
        or email <LegalStrong>catalogshare123@gmail.com</LegalStrong> from your registered business
        email address. We respond within 30 days and may first ask you to confirm your identity.
      </LegalText>

      <LegalHeading>12. Deleting your account</LegalHeading>
      <LegalText>
        You can delete your CatalogShare account and everything in it at any time. In the app open{" "}
        <LegalStrong>Settings &rarr; Delete account</LegalStrong>, or visit{" "}
        <LegalStrong>https://catalogshare.online/account-deletion</LegalStrong> (standalone copy:{" "}
        <LegalStrong>https://catalogshare.online/legal/account-deletion.html</LegalStrong>). That page
        lists exactly what is deleted, what is retained for tax purposes and how long it takes. Deletion
        is permanent.
      </LegalText>

      <LegalHeading>13. Cookies and local storage</LegalHeading>
      <LegalText>
        The app and website use browser or device storage for strictly necessary purposes: keeping you
        signed in, remembering your theme and skin, and holding offline estimates and the pending sync
        queue. The website also sets Google Analytics cookies (names beginning{" "}
        <LegalStrong>_ga</LegalStrong>) to measure traffic. We do not use cookies to build advertising
        profiles on the website. Clearing your browser or app storage removes all of this and signs you
        out.
      </LegalText>

      <LegalHeading>14. Changes to this policy</LegalHeading>
      <LegalText>
        We may update this policy as the product or the law changes. The effective date at the top
        always tells you which version is current. For material changes we will notify you in the app or
        by email to your registered address before they take effect. Continuing to use CatalogShare
        after that means you accept the updated policy.
      </LegalText>

      <LegalHeading>15. Grievance Officer (India)</LegalHeading>
      <LegalText>
        In accordance with the Information Technology Act, 2000, the Information Technology
        (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal
        Data Protection Act, 2023, the contact details of our Grievance Officer are:
      </LegalText>
      <LegalList>
        <LegalItem>
          <LegalStrong>Designation:</LegalStrong> Grievance Officer, CatalogShare
        </LegalItem>
        <LegalItem>
          <LegalStrong>Email:</LegalStrong> catalogshare123@gmail.com
        </LegalItem>
        <LegalItem>
          <LegalStrong>Phone:</LegalStrong> +91 76250 25686
        </LegalItem>
        <LegalItem>
          <LegalStrong>Address:</LegalStrong> CatalogShare, Gujarat, India (full postal address supplied
          on request)
        </LegalItem>
        <LegalItem>
          <LegalStrong>Hours:</LegalStrong> Monday to Saturday, 10:00 to 19:00 IST
        </LegalItem>
      </LegalList>
      <LegalText>
        We acknowledge every grievance within 24 hours of receipt and resolve it within 15 days. Please
        write from your registered business email and include your company name so we can locate your
        account.
      </LegalText>

      <LegalHeading>16. Contact us</LegalHeading>
      <LegalText>
        Questions about this policy, or about anything we hold on you: email{" "}
        <LegalStrong>catalogshare123@gmail.com</LegalStrong> or call{" "}
        <LegalStrong>+91 76250 25686</LegalStrong>.
      </LegalText>
    </LegalPage>
  );
};

export default Privacy;
