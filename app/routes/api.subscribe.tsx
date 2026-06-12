import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { SubscriberService } from "~/services/subscriber.server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MYSHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9-]+\.myshopify\.com$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

// In-memory rate limiter: Map<ip, { count: number; resetAt: number }>
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Handle CORS preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ error: "Method not allowed" }, 405);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return json({ error: "Too many requests. Please try again later." }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return json({ error: "Invalid request body." }, 400);
  }

  const { variantId, productId, productTitle, variantTitle, email, shop } = body as Record<string, unknown>;

  if (!shop || typeof shop !== "string" || !MYSHOPIFY_DOMAIN_REGEX.test(shop)) {
    return json({ error: "Missing or invalid shop." }, 400);
  }

  if (!variantId || typeof variantId !== "string") {
    return json({ error: "variantId is required." }, 400);
  }

  if (!productId || typeof productId !== "string") {
    return json({ error: "productId is required." }, 400);
  }

  if (!email || typeof email !== "string") {
    return json({ error: "email is required." }, 400);
  }

  if (!EMAIL_REGEX.test(email)) {
    return json({ error: "Invalid email address." }, 400);
  }

  await SubscriberService.create({
    shop,
    productId,
    variantId,
    productTitle: typeof productTitle === "string" ? productTitle.slice(0, 255) : undefined,
    variantTitle: typeof variantTitle === "string" ? variantTitle.slice(0, 255) : undefined,
    email,
  });

  return json({ success: true });
};
