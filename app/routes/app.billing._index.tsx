import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { reconcileShopPlan } from "../services/notification.server";

const PLANS = [
  {
    id: "FREE",
    name: "Free",
    price: 0,
    emails: 50,
    support: "Email support",
    popular: false,
  },
  {
    id: "STARTER",
    name: "Starter",
    price: 9,
    emails: 1000,
    trialDays: 7,
    support: "Priority support",
    popular: true,
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: 19,
    emails: 5000,
    trialDays: 7,
    support: "Priority support",
    popular: false,
  },
] as const;

const ALL_FEATURES = [
  { icon: "👥", label: "Unlimited subscribers" },
  { icon: "🎨", label: "Theme editor widget" },
  { icon: "✏️", label: "Email customisation" },
  { icon: "📤", label: "CSV & JSON export" },
  { icon: "🚀", label: "Manual send controls" },
  { icon: "⚡", label: "Auto-send on restock" },
];

const CREATE_SUBSCRIPTION = `#graphql
  mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int, $test: Boolean) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
    ) {
      userErrors { field message }
      confirmationUrl
      appSubscription { id }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { plan: currentPlan, activeUntil } = await reconcileShopPlan(
    session.shop,
    admin.graphql.bind(admin)
  );
  return { currentPlan, activeUntil };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const planId = formData.get("planId") as string;

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan || plan.price === 0) {
    return { error: "Invalid plan selected.", confirmationUrl: null };
  }

  const shopSlug = session.shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const returnUrl = `https://admin.shopify.com/store/${shopSlug}/apps/${apiKey}/app/billing/confirm`;

  const response = await admin.graphql(CREATE_SUBSCRIPTION, {
    variables: {
      name: `${plan.name} Plan`,
      returnUrl,
      trialDays: plan.trialDays,
      test: process.env.NODE_ENV !== "production",
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: plan.price, currencyCode: "USD" },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const json = await response.json();
  const result = json?.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    return { error: result.userErrors.map((e: { message: string }) => e.message).join(", "), confirmationUrl: null };
  }

  if (!result?.confirmationUrl) {
    return { error: "Could not create subscription. Please try again.", confirmationUrl: null };
  }

  return { confirmationUrl: result.confirmationUrl as string, error: null };
};

export default function BillingPage() {
  const { currentPlan, activeUntil } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingPlanId = navigation.formData?.get("planId") as string | null;

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.top
        ? (window.top.location.href = actionData.confirmationUrl)
        : (window.location.href = actionData.confirmationUrl);
    }
  }, [actionData]);

  return (
    <s-page heading="Plans & Billing">
      <s-stack direction="block" gap="base">

        {actionData?.error && (
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        )}

        {activeUntil && (
          <s-banner tone="info">
            <s-text>
              Your <strong>{currentPlan.charAt(0) + currentPlan.slice(1).toLowerCase()}</strong> plan
              is active and will renew on{" "}
              <strong>
                {new Date(activeUntil).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </strong>.
            </s-text>
          </s-banner>
        )}

        {/* ── Header ── */}
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#202223", marginBottom: "8px" }}>
            Simple, transparent pricing
          </div>
          <div style={{ fontSize: "14px", color: "#6d7175" }}>
            Every feature included on every plan. Only the email volume changes.
          </div>
          <div style={{
            display: "inline-block", marginTop: "12px",
            background: "#f0faf6", border: "1px solid #b5e3cc",
            borderRadius: "20px", padding: "5px 16px",
            fontSize: "13px", fontWeight: 600, color: "#008060",
          }}>
            7-day free trial on paid plans
          </div>
        </div>

        {/* ── Plan cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isUpgrade =
              (currentPlan === "FREE" && plan.id !== "FREE") ||
              (currentPlan === "STARTER" && plan.id === "GROWTH");
            const isDowngrade =
              (currentPlan === "GROWTH" && plan.id === "STARTER") ||
              (currentPlan !== "FREE" && plan.id === "FREE");

            return (
              <div
                key={plan.id}
                style={{
                  background: plan.popular ? "#f6fffe" : "#fff",
                  border: isCurrent
                    ? "2px solid #008060"
                    : plan.popular
                    ? "2px solid #008060"
                    : "1px solid #e4e5e7",
                  borderRadius: "12px",
                  padding: "28px 24px 24px",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Badge: current plan takes priority over popular */}
                {isCurrent ? (
                  <div style={{
                    position: "absolute", top: "-13px", left: "50%",
                    transform: "translateX(-50%)",
                    background: "#008060", color: "#fff",
                    fontSize: "11px", fontWeight: 700,
                    padding: "3px 14px", borderRadius: "20px",
                    whiteSpace: "nowrap", letterSpacing: "0.05em", textTransform: "uppercase",
                  }}>
                    Current plan
                  </div>
                ) : plan.popular ? (
                  <div style={{
                    position: "absolute", top: "-13px", left: "50%",
                    transform: "translateX(-50%)",
                    background: "#008060", color: "#fff",
                    fontSize: "11px", fontWeight: 700,
                    padding: "3px 14px", borderRadius: "20px",
                    whiteSpace: "nowrap", letterSpacing: "0.05em", textTransform: "uppercase",
                  }}>
                    Most popular
                  </div>
                ) : null}

                {/* Plan name */}
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
                  {plan.name}
                </div>

                {/* Price */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "2px", marginBottom: "20px" }}>
                  {plan.price === 0 ? (
                    <span style={{ fontSize: "38px", fontWeight: 800, color: "#202223" }}>Free</span>
                  ) : (
                    <>
                      <span style={{ fontSize: "16px", fontWeight: 600, color: "#6d7175", alignSelf: "flex-start", marginTop: "8px" }}>$</span>
                      <span style={{ fontSize: "38px", fontWeight: 800, color: "#202223" }}>{plan.price}</span>
                      <span style={{ fontSize: "14px", color: "#6d7175", marginLeft: "2px" }}>/mo</span>
                    </>
                  )}
                </div>

                {/* Email volume — the hero differentiator */}
                <div style={{
                  background: plan.popular ? "#e6f4f0" : "#f6f6f7",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  marginBottom: "20px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: "28px", fontWeight: 800, color: "#008060", lineHeight: 1 }}>
                    {plan.emails.toLocaleString()}
                  </div>
                  <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px", fontWeight: 500 }}>
                    emails / month
                  </div>
                </div>

                {/* Support tier */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  fontSize: "13px", color: "#202223", marginBottom: "24px",
                }}>
                  <span style={{ color: "#008060", fontWeight: 700 }}>✓</span>
                  {plan.support}
                </div>

                {/* CTA */}
                {isCurrent ? (
                  <s-button variant="secondary" disabled>Current plan</s-button>
                ) : plan.price === 0 ? (
                  isDowngrade ? (
                    <Form method="post" action="/app/billing/downgrade">
                      <s-button variant="secondary" type="submit">Downgrade to Free</s-button>
                    </Form>
                  ) : null
                ) : (
                  <Form method="post">
                    <input type="hidden" name="planId" value={plan.id} />
                    <s-button
                      variant="primary"
                      type="submit"
                      {...(isSubmitting && submittingPlanId === plan.id ? { loading: true } : {})}
                    >
                      {isUpgrade ? `Upgrade to ${plan.name}` : `Select ${plan.name}`}
                    </s-button>
                  </Form>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Everything included ── */}
        <div style={{
          background: "#fff", border: "1px solid #e4e5e7",
          borderRadius: "12px", padding: "24px 28px",
        }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#202223", marginBottom: "16px" }}>
            Everything included on every plan
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px 24px",
          }}>
            {ALL_FEATURES.map((f) => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#202223" }}>
                <span style={{ fontSize: "16px" }}>{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </div>

      </s-stack>
    </s-page>
  );
}
