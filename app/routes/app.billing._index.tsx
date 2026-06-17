import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { getShopSettings, saveShopSettings } from "../services/notification.server";

const PLAN_NAME_TO_ID: Record<string, string> = {
  "Starter Plan": "STARTER",
  "Growth Plan": "GROWTH",
};

const ACTIVE_SUBSCRIPTION_DETAIL = `#graphql
  query {
    currentAppInstallation {
      activeSubscriptions { id name status currentPeriodEnd }
    }
  }
`;

const PLANS = [
  {
    id: "FREE",
    name: "Free",
    price: 0,
    emails: 50,
    features: ["50 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation"],
  },
  {
    id: "STARTER",
    name: "Starter",
    price: 9,
    emails: 1000,
    trialDays: 7,
    features: ["1,000 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation", "CSV & JSON export", "Priority support"],
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: 19,
    emails: 5000,
    trialDays: 7,
    features: ["5,000 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation", "CSV & JSON export", "Priority support", "Manual send controls"],
  },
] as const;

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
  const settings = await getShopSettings(session.shop);

  const res = await admin.graphql(ACTIVE_SUBSCRIPTION_DETAIL);
  const json = await res.json();
  const subs: { id: string; name: string; status: string; currentPeriodEnd: string | null }[] =
    json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const active = subs.find((s) => s.status === "ACTIVE");

  let currentPlan = settings?.plan ?? "FREE";
  let activeUntil: string | null = null;

  if (active) {
    const planId = PLAN_NAME_TO_ID[active.name] ?? null;
    if (planId && planId !== currentPlan) {
      await saveShopSettings(session.shop, { plan: planId });
      currentPlan = planId;
    }
    activeUntil = active.currentPeriodEnd ?? null;
  } else if (currentPlan !== "FREE") {
    await saveShopSettings(session.shop, { plan: "FREE" });
    currentPlan = "FREE";
  }

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

        {/* ── Intro card ── */}
        <div style={{
          background: "#fff", border: "1px solid #e4e5e7",
          borderRadius: "10px", padding: "20px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
        }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223", marginBottom: "4px" }}>
              Choose the right plan for your store
            </div>
            <div style={{ fontSize: "13px", color: "#6d7175" }}>
              All paid plans include a 7-day free trial. Cancel any time — no questions asked.
            </div>
          </div>
          <div style={{
            background: "#f0faf6", border: "1px solid #b5e3cc",
            borderRadius: "8px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 600, color: "#008060", whiteSpace: "nowrap",
          }}>
            7-day free trial
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
                  background: "#fff",
                  border: isCurrent ? "2px solid #008060" : "1px solid #e4e5e7",
                  borderRadius: "10px",
                  padding: "24px",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {isCurrent && (
                  <div style={{
                    position: "absolute", top: "-12px", left: "50%",
                    transform: "translateX(-50%)",
                    background: "#008060", color: "#fff",
                    fontSize: "11px", fontWeight: 700,
                    padding: "3px 12px", borderRadius: "20px",
                    whiteSpace: "nowrap", letterSpacing: "0.04em", textTransform: "uppercase",
                  }}>
                    Current plan
                  </div>
                )}

                {/* Plan name + price */}
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#202223", marginBottom: "10px" }}>
                    {plan.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
                    {plan.price === 0 ? (
                      <span style={{ fontSize: "32px", fontWeight: 800, color: "#202223" }}>Free</span>
                    ) : (
                      <>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "#6d7175", marginTop: "6px", alignSelf: "flex-start" }}>$</span>
                        <span style={{ fontSize: "32px", fontWeight: 800, color: "#202223" }}>{plan.price}</span>
                        <span style={{ fontSize: "13px", color: "#6d7175" }}>/mo</span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                    {plan.emails.toLocaleString()} emails / month
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height: "1px", background: "#f1f2f3", marginBottom: "16px" }} />

                {/* Features */}
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ fontSize: "13px", color: "#202223", padding: "5px 0", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                      <span style={{
                        color: "#008060", fontWeight: 700, fontSize: "12px",
                        marginTop: "1px", flexShrink: 0,
                      }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

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

      </s-stack>
    </s-page>
  );
}
