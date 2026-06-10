import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { NotificationService, PlanLimitError } from "~/services/notification.server";

const VARIANT_FROM_INVENTORY_ITEM = `#graphql
  query VariantFromInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        id
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  const inventoryPayload = payload as {
    inventory_item_id?: number;
    location_id?: number;
    available?: number;
  };

  const available = inventoryPayload?.available ?? 0;

  if (available <= 0) {
    return new Response(null, { status: 200 });
  }

  const inventoryItemId = String(inventoryPayload.inventory_item_id ?? "");

  if (!inventoryItemId) {
    console.warn(`[webhook:inventory_levels/update] Missing inventory_item_id for ${shop}`);
    return new Response(null, { status: 200 });
  }

  let variantId: string;

  if (admin) {
    try {
      const response = await admin.graphql(VARIANT_FROM_INVENTORY_ITEM, {
        variables: { id: `gid://shopify/InventoryItem/${inventoryItemId}` },
      });
      const json = await response.json();
      const gid = json?.data?.inventoryItem?.variant?.id;
      if (!gid) {
        console.warn(`[webhook:inventory_levels/update] No variant for inventory item ${inventoryItemId} on ${shop}`);
        return new Response(null, { status: 200 });
      }
      variantId = gid;
    } catch (err) {
      console.error(`[webhook:inventory_levels/update] GraphQL lookup failed for ${inventoryItemId} on ${shop}:`, err);
      return new Response(null, { status: 200 });
    }
  } else {
    // CLI-triggered webhooks don't provide an admin client — skip silently in dev
    console.warn(`[webhook:inventory_levels/update] No admin client (CLI trigger?) — cannot resolve variantId for ${inventoryItemId}`);
    return new Response(null, { status: 200 });
  }

  // Fire-and-forget: return 200 immediately so Shopify doesn't retry
  NotificationService.sendRestock({ shop, variantId }).catch((err: unknown) => {
    if (err instanceof PlanLimitError) {
      console.log(`[webhook:inventory_levels/update] Plan limit reached for ${shop}: ${err.message}`);
    } else {
      console.error(`[webhook:inventory_levels/update] sendRestock failed for ${shop} / ${variantId}:`, err);
    }
  });

  return new Response(null, { status: 200 });
};
