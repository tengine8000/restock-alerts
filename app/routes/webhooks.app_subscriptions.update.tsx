import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { saveShopSettings } from "~/services/notification.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const subscription = (payload as { app_subscription?: { status?: string; name?: string } })
    ?.app_subscription;

  const status = subscription?.status?.toUpperCase();

  if (status === "CANCELLED" || status === "EXPIRED" || status === "DECLINED") {
    await saveShopSettings(shop, { plan: "FREE" });
    console.log(`[webhook:app_subscriptions/update] ${shop} downgraded to FREE (subscription ${status})`);
  }

  return new Response(null, { status: 200 });
};
