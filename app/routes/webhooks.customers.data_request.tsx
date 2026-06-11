import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: customers/data_request
 * Shopify fires this when a customer requests a copy of their data.
 * We must respond 200 immediately. The actual data report is handled
 * out-of-band (email the customer the data we hold about them).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const body = payload as {
    customer?: { id?: number; email?: string };
    orders_requested?: number[];
  };

  const email = body?.customer?.email;

  if (email) {
    const subscribers = await db.subscriber.findMany({
      where: { shop, email },
      select: {
        email: true,
        productId: true,
        variantId: true,
        status: true,
        subscribedAt: true,
        notifiedAt: true,
      },
    });

    // Log the data we hold so it can be retrieved and sent to the customer if needed
    console.log(
      `[gdpr:customers/data_request] shop=${shop} email=${email} records=${subscribers.length}`,
      JSON.stringify(subscribers)
    );
  }

  return new Response(null, { status: 200 });
};
