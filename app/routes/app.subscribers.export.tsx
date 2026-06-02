import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { exportSubscribersCsv } from "../services/subscriber.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const generator = await exportSubscribersCsv({ shop, productId, status });

  // Collect all CSV chunks into a single string.
  // Phase 1 can replace this with a true streaming Response once the
  // generator yields real rows.
  const chunks: string[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  const csvBody = chunks.join("");

  return new Response(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscribers.csv"',
    },
  });
};
