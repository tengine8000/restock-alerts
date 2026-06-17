import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { saveShopSettings, reconcileShopPlan } from "~/services/notification.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  if (admin) {
    // Production: query live state and reconcile — never rely on webhook payload status alone.
    // DECLINED fires when a pending upgrade is cancelled (should not affect existing plan).
    // CANCELLED fires during plan switches before the new plan is confirmed.
    const { plan } = await reconcileShopPlan(shop, admin.graphql.bind(admin));
    console.log(`[webhook:app_subscriptions/update] ${shop} plan reconciled to ${plan}`);
  } else {
    // CLI test mode: admin client not available; fall back to payload-based logic.
    const sub = (payload as { app_subscription?: { status?: string } })?.app_subscription;
    const status = sub?.status?.toUpperCase();
    if (status === "CANCELLED" || status === "EXPIRED") {
      await saveShopSettings(shop, { plan: "FREE" });
      console.log(`[webhook:app_subscriptions/update] ${shop} downgraded to FREE (CLI mode, status: ${status})`);
    }
    // DECLINED: do nothing — a declined pending subscription leaves any existing active plan intact.
  }

  return new Response(null, { status: 200 });
};
