import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { saveShopSettings } from "../services/notification.server";

const ACTIVE_SUBSCRIPTION = `#graphql
  query ActiveSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

const PLAN_NAME_TO_ID: Record<string, string> = {
  "Starter Plan": "STARTER",
  "Growth Plan": "GROWTH",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Verify the subscription is now active
  const response = await admin.graphql(ACTIVE_SUBSCRIPTION);
  const json = await response.json();

  const subscriptions: { id: string; name: string; status: string }[] =
    json?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const active = subscriptions.find((s) => s.status === "ACTIVE");

  if (!active) {
    return { success: false, plan: null, message: "Subscription not confirmed. Please try again or contact support." };
  }

  const planId = PLAN_NAME_TO_ID[active.name] ?? null;

  if (planId) {
    await saveShopSettings(shop, { plan: planId });
  }

  return { success: true, plan: planId, message: null };
};

export default function BillingConfirmPage() {
  const { success, plan, message } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Plan confirmed">
      <s-section>
        {success ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="success">
              <s-text>
                You&apos;re now on the <strong>{plan}</strong> plan. Your 7-day free trial has started.
              </s-text>
            </s-banner>
            <div>
              <s-link href="/app">
                <s-button variant="primary">Go to Dashboard</s-button>
              </s-link>
            </div>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">
              <s-text>{message}</s-text>
            </s-banner>
            <div>
              <s-link href="/app/billing">
                <s-button variant="secondary">Back to plans</s-button>
              </s-link>
            </div>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
