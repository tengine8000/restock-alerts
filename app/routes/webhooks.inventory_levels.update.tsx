import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { NotificationService, PlanLimitError } from "~/services/notification.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const inventoryPayload = payload as {
    inventory_item_id?: number;
    location_id?: number;
    available?: number;
  };

  const available = inventoryPayload?.available ?? 0;

  // Nothing to do if still out of stock
  if (available <= 0) {
    return new Response(null, { status: 200 });
  }

  const inventoryItemId = String(inventoryPayload.inventory_item_id ?? "");

  if (!inventoryItemId) {
    console.warn(
      `[webhooks.inventory_levels.update] Missing inventory_item_id for shop ${shop}`
    );
    return new Response(null, { status: 200 });
  }

  // TODO (Phase 2): Map inventory_item_id → variant_id via Shopify Admin GraphQL
  // query { inventoryItem(id: "gid://shopify/InventoryItem/<id>") { variant { id } } }
  // For now, the inventoryItemId is used as a stand-in for the variantId.
  const variantId = inventoryItemId;

  // Fire-and-forget: don't await — return 200 immediately so Shopify doesn't retry
  NotificationService.sendRestock({ shop, variantId }).catch((err: unknown) => {
    if (err instanceof PlanLimitError) {
      // Expected — do not log as an error
      console.log(
        `[webhooks.inventory_levels.update] Plan limit reached for ${shop}: ${err.message}`
      );
    } else {
      console.error(
        `[webhooks.inventory_levels.update] sendRestock failed for ${shop} / ${variantId}:`,
        err
      );
    }
  });

  return new Response(null, { status: 200 });
};
