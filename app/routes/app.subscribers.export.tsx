import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { exportSubscribersCsv } from "../services/subscriber.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? undefined;
  const status = url.searchParams.get("status") || undefined;
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";

  if (format === "json") {
    const subscribers = await prisma.subscriber.findMany({
      where: {
        shop,
        ...(productId ? { productId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { subscribedAt: "asc" },
      select: {
        email: true,
        productId: true,
        variantId: true,
        status: true,
        subscribedAt: true,
        notifiedAt: true,
      },
    });

    return new Response(JSON.stringify(subscribers, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscribers.json"',
      },
    });
  }

  const generator = await exportSubscribersCsv({ shop, productId, status });

  const chunks: string[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }

  return new Response(chunks.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscribers.csv"',
    },
  });
};
