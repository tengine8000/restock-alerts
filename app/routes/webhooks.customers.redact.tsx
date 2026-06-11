import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: customers/redact
 * Shopify fires this when a customer requests deletion of their data.
 * We must delete all personal data we hold for that customer (email address).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const body = payload as {
    customer?: { id?: number; email?: string };
  };

  const email = body?.customer?.email;

  if (email) {
    const { count } = await db.subscriber.deleteMany({
      where: { shop, email },
    });

    console.log(
      `[gdpr:customers/redact] shop=${shop} email=${email} deleted=${count} subscriber records`
    );
  }

  return new Response(null, { status: 200 });
};
