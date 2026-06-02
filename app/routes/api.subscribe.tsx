import type { ActionFunctionArgs } from "react-router";
import { SubscriberService } from "~/services/subscriber.server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MYSHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9-]+\.myshopify\.com$/;

// In-memory rate limiter: Map<ip, { count: number; resetAt: number }>
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false; // blocked
  }

  entry.count++;
  return true; // allowed
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Validate shop from query param (added by theme extension JS)
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop || !MYSHOPIFY_DOMAIN_REGEX.test(shop)) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid shop parameter." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body !== "object" || body === null) {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { variantId, productId, email } = body as Record<string, unknown>;

  if (!variantId || typeof variantId !== "string") {
    return new Response(
      JSON.stringify({ error: "variantId is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (!productId || typeof productId !== "string") {
    return new Response(
      JSON.stringify({ error: "productId is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ error: "email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!EMAIL_REGEX.test(email)) {
    return new Response(
      JSON.stringify({ error: "Invalid email address." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  await SubscriberService.create({ shop, productId, variantId, email });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// No default export — this is an API-only route
