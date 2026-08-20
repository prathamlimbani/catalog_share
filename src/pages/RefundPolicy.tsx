import LegalPage, {
  LegalHeading,
  LegalItem,
  LegalList,
  LegalNote,
  LegalStrong,
  LegalText,
} from "@/components/LegalPage";

/**
 * /refund — Return, Refund & Cancellation policy.
 *
 * The critical fact for both Play review and Razorpay compliance is that plans
 * are a single 30-day charge with no mandate behind them; the wording below is
 * deliberately blunt about that because "subscription" makes people assume an
 * auto-debit exists.
 */
const RefundPolicy = () => {
  return (
    <LegalPage
      title="Return, Refund & Cancellation Policy"
      effectiveDate="19 August 2026"
      lastUpdated="19 August 2026"
    >
      <LegalNote>
        CatalogShare plans are a <LegalStrong>one-time 30-day charge</LegalStrong>. Nothing
        auto-debits. There is no mandate, no e-NACH and no standing instruction on your card or UPI.
        When 30 days are up your plan simply lapses and you drop back to the free plan until you choose
        to pay again.
      </LegalNote>

      <LegalHeading>1. How billing actually works</LegalHeading>
      <LegalText>
        You pay once, through Razorpay, for a single 30-day period on the plan you picked. That payment
        unlocks the plan immediately and the expiry date is set to 30 days later. We never store your
        card or UPI credentials and we never register a recurring mandate against them, so we are
        technically unable to charge you again without you starting a new payment yourself.
      </LegalText>
      <LegalList>
        <LegalItem>Growth Plan &mdash; &#8377;199 for 30 days.</LegalItem>
        <LegalItem>Pro Plan &mdash; &#8377;349 for 30 days.</LegalItem>
        <LegalItem>Estimate Generator Plan &mdash; &#8377;399 for 30 days.</LegalItem>
        <LegalItem>Monthly Support Subscription &mdash; &#8377;499 for 30 days.</LegalItem>
        <LegalItem>Free Plan &mdash; &#8377;0, no payment, ad-supported.</LegalItem>
      </LegalList>
      <LegalText>
        Prices are in Indian Rupees and include applicable taxes unless stated otherwise at checkout.
        CatalogShare is a digital service delivered instantly, so there is nothing to physically return
        &mdash; &ldquo;return&rdquo; in this policy means a refund of the amount paid.
      </LegalText>

      <LegalHeading>2. How to cancel</LegalHeading>
      <LegalText>
        <LegalStrong>Just do not renew.</LegalStrong> That is the whole process. There is no
        cancellation form, no notice period and no cancellation fee. Your plan runs to its expiry date
        and then stops. You keep every paid feature until the last day of the period you paid for.
      </LegalText>
      <LegalText>
        If you would like written confirmation that no further charge exists, email{" "}
        <LegalStrong>catalogshare123@gmail.com</LegalStrong> and we will confirm in writing. If you want
        your data removed as well, that is a separate request &mdash; see section 7.
      </LegalText>

      <LegalHeading>3. When you can get a refund</LegalHeading>
      <LegalText>
        We will consider a refund if you write to us{" "}
        <LegalStrong>within 7 days of the payment date</LegalStrong> and the reason is a genuine service
        failure on our side. Typical qualifying cases:
      </LegalText>
      <LegalList>
        <LegalItem>
          You were charged but the plan never activated on your account, and we could not activate it
          for you.
        </LegalItem>
        <LegalItem>You were charged twice for the same plan and period.</LegalItem>
        <LegalItem>
          A core feature of the plan you bought was unusable for a sustained period because of a fault
          on our side, and we could not fix it after you reported it.
        </LegalItem>
        <LegalItem>
          You were charged for a plan you did not buy, from a payment method you control.
        </LegalItem>
      </LegalList>
      <LegalText>
        Refunds outside these cases are granted at CatalogShare&rsquo;s sole discretion. Approving one
        request does not oblige us to approve a similar one later.
      </LegalText>

      <LegalHeading>4. When you cannot get a refund</LegalHeading>
      <LegalList>
        <LegalItem>Requests made more than 7 days after the payment date.</LegalItem>
        <LegalItem>
          Change of mind after you have used the plan. Every account gets a free trial of the estimate
          features before paying &mdash; please use it to check the product suits you.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Partially used periods.</LegalStrong> We do not refund the unused remainder of a
          30-day period, and we do not pro-rate.
        </LegalItem>
        <LegalItem>Simply not having used the plan you paid for.</LegalItem>
        <LegalItem>
          Problems caused by your device, your internet connection, WhatsApp, your browser, or any other
          third-party service outside our control.
        </LegalItem>
        <LegalItem>
          Accounts suspended or terminated for breaching our Terms &amp; Conditions, including uploading
          unlawful content or abusing the service.
        </LegalItem>
        <LegalItem>
          Dissatisfaction with a feature that works as documented, or with a limit clearly stated on the
          pricing page.
        </LegalItem>
        <LegalItem>The free plan, since no payment was made.</LegalItem>
      </LegalList>

      <LegalHeading>5. Failed or duplicate payments</LegalHeading>
      <LegalText>
        If money left your account but your plan did not activate, do not pay again &mdash; email us
        first. In almost every case the payment is simply pending at the bank and we can activate the
        plan manually. If the payment genuinely failed, Razorpay reverses it automatically to the
        original payment method, usually within 5 to 7 business days. For a confirmed duplicate charge
        you choose: a full refund of the extra payment, or an extra 30 days added to your plan.
      </LegalText>

      <LegalHeading>6. How to request a refund</LegalHeading>
      <LegalText>
        Email <LegalStrong>catalogshare123@gmail.com</LegalStrong> with the subject{" "}
        <LegalStrong>Refund request</LegalStrong>, from the email address registered on your
        CatalogShare account, and include:
      </LegalText>
      <LegalList ordered>
        <LegalItem>your registered business email and company name;</LegalItem>
        <LegalItem>
          the <LegalStrong>Razorpay payment id</LegalStrong> (it starts with{" "}
          <LegalStrong>pay_</LegalStrong> and appears on your payment confirmation and in Billing);
        </LegalItem>
        <LegalItem>the amount and the date of payment;</LegalItem>
        <LegalItem>the plan you bought;</LegalItem>
        <LegalItem>what went wrong, with a screenshot if you have one.</LegalItem>
      </LegalList>
      <LegalText>
        We acknowledge within 24 hours and tell you our decision within 3 business days. If approved,
        the refund is processed through Razorpay back to the{" "}
        <LegalStrong>original payment method</LegalStrong> and reaches you in{" "}
        <LegalStrong>5 to 7 business days</LegalStrong>. We cannot refund to a different card, account
        or UPI id. Your bank may add its own settlement time on top.
      </LegalText>

      <LegalHeading>7. What happens to your data when a plan lapses</LegalHeading>
      <LegalText>
        <LegalStrong>Your data is not deleted.</LegalStrong> When a plan expires or a refund is issued,
        the account reverts to the free plan: paid features lock, but the content stays.
      </LegalText>
      <LegalList>
        <LegalItem>
          Products above the free-plan limit are hidden from your public storefront, not deleted. They
          reappear the moment you upgrade again.
        </LegalItem>
        <LegalItem>
          Existing estimates and invoices remain stored and viewable; creating new ones locks until you
          are back on a plan that includes the estimate generator.
        </LegalItem>
        <LegalItem>Premium skins revert to the standard theme.</LegalItem>
        <LegalItem>Ads return, because the free plan is ad-supported.</LegalItem>
        <LegalItem>Your storefront link, slug, logo and company details are untouched.</LegalItem>
      </LegalList>
      <LegalText>
        Deleting your <LegalStrong>account</LegalStrong> is a separate, permanent action &mdash; see the
        Account Deletion page. Cancelling or lapsing never deletes anything by itself.
      </LegalText>

      <LegalHeading>8. Chargebacks</LegalHeading>
      <LegalText>
        Please contact us before raising a chargeback with your bank. Chargebacks take weeks, cost both
        sides money, and we can almost always resolve the issue faster. While a chargeback is open we
        may suspend the paid features on the account until the bank decides.
      </LegalText>

      <LegalHeading>9. Price changes</LegalHeading>
      <LegalText>
        We may change plan prices. Because nothing auto-renews, a price change can never surprise you
        mid-period: the price you see at checkout is the price you pay for that 30-day period, and any
        change applies only to a payment you choose to make afterwards.
      </LegalText>

      <LegalHeading>10. Changes to this policy</LegalHeading>
      <LegalText>
        We may update this policy. The effective date at the top identifies the current version, and the
        version in force on the date of your payment is the one that governs it.
      </LegalText>

      <LegalHeading>11. Contact</LegalHeading>
      <LegalText>
        CatalogShare, Gujarat, India. Email <LegalStrong>catalogshare123@gmail.com</LegalStrong>,
        website <LegalStrong>https://catalogshare.online</LegalStrong>.
      </LegalText>
    </LegalPage>
  );
};

export default RefundPolicy;
