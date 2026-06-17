import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { saveShopSettings } from "~/services/notification.server";

const PLAN_NAME_TO_ID: Record<string, string> = {
  "Starter Plan": "STARTER",
  "Growth Plan": "GROWTH",
};

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query {
    currentAppInstallation {
      activeSubscriptions { id name status }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  if (admin) {
    // Production: query live state and reconcile — never rely on webhook payload status alone.
    // DECLINED fires when a pending upgrade is cancelled (should not affect existing plan).
    // CANCELLED fires during plan switches before the new plan is confirmed.
    const res = await admin.graphql(ACTIVE_SUBSCRIPTIONS);
    const json = await res.json();
    const subs: { id: string; name: string; status: string }[] =
      json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.find((s) => s.status === "ACTIVE");

    if (active) {
      const planId = PLAN_NAME_TO_ID[active.name] ?? null;
      if (planId) {
        await saveShopSettings(shop, { plan: planId });
        console.log(`[webhook:app_subscriptions/update] ${shop} plan set to ${planId} (active subscription found)`);
      }
    } else {
      await saveShopSettings(shop, { plan: "FREE" });
      console.log(`[webhook:app_subscriptions/update] ${shop} downgraded to FREE (no active subscription)`);
    }
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
