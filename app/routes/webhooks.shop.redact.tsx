import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: shop/redact
 * Shopify fires this 48 hours after a merchant uninstalls the app.
 * We must delete ALL data we hold for the shop — subscribers, logs, settings.
 * Sessions are already deleted by the app/uninstalled webhook.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Delete in dependency order: logs reference subscribers, settings is standalone
  const [logs, subscribers, settings] = await Promise.all([
    db.notificationLog.deleteMany({ where: { shop } }),
    db.subscriber.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
  ]);

  console.log(
    `[gdpr:shop/redact] shop=${shop} deleted: ${subscribers.count} subscribers, ${logs.count} logs, ${settings.count} settings`
  );

  return new Response(null, { status: 200 });
};
