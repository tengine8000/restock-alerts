import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { exportSubscribersCsv, exportSubscribersJson } from "../services/subscriber.server";

function streamFrom(generator: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await generator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await generator.return(undefined);
    },
  });
}

async function* csvChunks(opts: { shop: string; productId?: string; status?: string }) {
  for await (const chunk of exportSubscribersCsv(opts)) {
    yield chunk;
  }
}

async function* jsonChunks(opts: { shop: string; productId?: string; status?: string }) {
  yield "[\n";
  let first = true;
  for await (const sub of exportSubscribersJson(opts)) {
    yield (first ? "" : ",\n") + JSON.stringify(sub, null, 2);
    first = false;
  }
  yield "\n]\n";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? undefined;
  const VALID_STATUSES = ["PENDING", "NOTIFIED", "UNSUBSCRIBED"];
  const rawStatus = url.searchParams.get("status") ?? "";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : undefined;
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";

  if (format === "json") {
    return new Response(streamFrom(jsonChunks({ shop, productId, status })), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscribers.json"',
      },
    });
  }

  return new Response(streamFrom(csvChunks({ shop, productId, status })), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscribers.csv"',
    },
  });
};
