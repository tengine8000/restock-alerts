import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { getShopSettings } from "../services/notification.server";

const PLANS = [
  {
    id: "FREE",
    name: "Free",
    price: 0,
    emails: 50,
    features: ["50 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation"],
    cta: "Current plan",
  },
  {
    id: "STARTER",
    name: "Starter",
    price: 9,
    emails: 1000,
    features: ["1,000 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation", "CSV & JSON export", "Priority support"],
    cta: "Start 7-day free trial",
    trialDays: 7,
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: 19,
    emails: 5000,
    features: ["5,000 emails / month", "Unlimited subscribers", "Theme editor widget", "Email customisation", "CSV & JSON export", "Priority support", "Manual send controls"],
    cta: "Start 7-day free trial",
    trialDays: 7,
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
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { currentPlan: settings?.plan ?? "FREE" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const planId = formData.get("planId") as string;

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan || plan.price === 0) {
    return { error: "Invalid plan selected." };
  }

  const url = new URL(request.url);
  const returnUrl = `${url.origin}/app/billing/confirm`;

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
    return { error: result.userErrors.map((e: { message: string }) => e.message).join(", ") };
  }

  if (!result?.confirmationUrl) {
    return { error: "Could not create subscription. Please try again." };
  }

  // Return the URL to the component — it must navigate window.top, not the iframe
  return { confirmationUrl: result.confirmationUrl as string, error: null };
};

export default function BillingPage() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingPlanId = navigation.formData?.get("planId") as string | null;

  // Billing confirmation page must load in the top frame, not the iframe
  useEffect(() => {
    if (actionData && "confirmationUrl" in actionData && actionData.confirmationUrl) {
      window.top ? (window.top.location.href = actionData.confirmationUrl) : (window.location.href = actionData.confirmationUrl);
    }
  }, [actionData]);

  return (
    <s-page heading="Choose a plan">
      <s-stack direction="block" gap="base">
        {actionData?.error && (
          <s-banner tone="critical">
            <s-text>Something went wrong: {actionData.error}</s-text>
          </s-banner>
        )}

        <s-section>
          <s-text>
            All paid plans include a 7-day free trial. Cancel any time from your Shopify admin.
          </s-text>
        </s-section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            alignItems: "start",
          }}
        >
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
                  border: isCurrent ? "2px solid #008060" : "1px solid #e4e5e7",
                  borderRadius: "8px",
                  padding: "24px",
                  background: "#fff",
                  position: "relative",
                }}
              >
                {isCurrent && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#008060",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 12px",
                      borderRadius: "20px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Current plan
                  </div>
                )}

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>{plan.name}</div>
                  <div style={{ marginTop: "8px" }}>
                    {plan.price === 0 ? (
                      <span style={{ fontSize: "28px", fontWeight: 700 }}>Free</span>
                    ) : (
                      <>
                        <span style={{ fontSize: "28px", fontWeight: 700 }}>${plan.price}</span>
                        <span style={{ fontSize: "14px", color: "#6d7175" }}> / month</span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                    {plan.emails.toLocaleString()} emails / month
                  </div>
                </div>

                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px 0" }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ fontSize: "14px", padding: "4px 0", display: "flex", gap: "8px" }}>
                      <span style={{ color: "#008060" }}>✓</span> {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <s-button variant="secondary" disabled>
                    Current plan
                  </s-button>
                ) : plan.price === 0 ? (
                  isDowngrade ? (
                    <Form method="post" action="/app/billing/downgrade">
                      <s-button
                        variant="secondary"
                        type="submit"
                      >
                        Downgrade to Free
                      </s-button>
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
                      {isUpgrade ? "Upgrade" : "Select plan"}
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
