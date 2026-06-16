import type { ShopSettings } from "@prisma/client";
import prisma from "~/db.server";
import { getEmailProvider, NoOpProvider } from "~/services/email/index";
import { SubscriberService } from "~/services/subscriber.server";

export type { ShopSettings };

export const PLAN_LIMITS: Record<string, number> = {
  FREE: 50,
  STARTER: 1000,
  GROWTH: 5000,
};

export const DEFAULT_SETTINGS: ShopSettings = {
  shop: "",
  autoSendEnabled: true,
  plan: "FREE",
  emailFromName: "Your Store",
  emailSubject: "Good news — your item is back in stock!",
  emailBodyHtml: "",
  onboardingCompletedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export class PlanLimitError extends Error {
  constructor(
    public readonly plan: string,
    public readonly limit: number,
    public readonly current: number
  ) {
    super(
      `Monthly email limit reached for plan ${plan}: ${current}/${limit}`
    );
    this.name = "PlanLimitError";
  }
}

export interface RestockResult {
  sent: number;
  skipped: number;
  failed: number;
}

type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PRODUCT_FROM_VARIANT = `#graphql
  query ProductFromVariant($id: ID!) {
    productVariant(id: $id) {
      product {
        title
        handle
        onlineStoreUrl
      }
    }
  }
`;

async function fetchProductInfo(
  admin: AdminGraphQL,
  variantId: string,
  shop: string
): Promise<{ title: string; url: string }> {
  try {
    const res = await admin(PRODUCT_FROM_VARIANT, {
      variables: { id: `gid://shopify/ProductVariant/${variantId}` },
    });
    const json = await res.json();
    const product = json?.data?.productVariant?.product;
    if (!product) return { title: "Your Product", url: `https://${shop}` };
    const url =
      product.onlineStoreUrl ?? `https://${shop}/products/${product.handle}`;
    return { title: product.title, url };
  } catch {
    return { title: "Your Product", url: `https://${shop}` };
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function buildEmailHtml(
  template: string,
  productTitle: string,
  productUrl: string
): string {
  const safeUrl = isSafeUrl(productUrl) ? productUrl : "#";
  return template
    .replace(/\{\{product_title\}\}/g, escapeHtml(productTitle))
    .replace(/\{\{product_url\}\}/g, escapeHtml(safeUrl));
}

/** Returns ShopSettings for a shop, or null if not found. */
export async function getShopSettings(
  shop: string
): Promise<ShopSettings | null> {
  return prisma.shopSettings.findUnique({ where: { shop } });
}

/** Upserts ShopSettings for a shop. */
export async function saveShopSettings(
  shop: string,
  data: Partial<Omit<ShopSettings, "shop" | "createdAt">>
): Promise<ShopSettings> {
  return prisma.shopSettings.upsert({
    where: { shop },
    create: {
      shop,
      autoSendEnabled: data.autoSendEnabled ?? DEFAULT_SETTINGS.autoSendEnabled,
      plan: data.plan ?? DEFAULT_SETTINGS.plan,
      emailFromName: data.emailFromName ?? DEFAULT_SETTINGS.emailFromName,
      emailSubject: data.emailSubject ?? DEFAULT_SETTINGS.emailSubject,
      emailBodyHtml: data.emailBodyHtml ?? DEFAULT_SETTINGS.emailBodyHtml,
    },
    update: data,
  });
}

/** Sends a test email to the given address. */
export async function sendTestEmail(
  shop: string,
  toEmail: string
): Promise<void> {
  return NotificationService.sendTest({ shop, toEmail });
}

/** Returns true if the shop hasn't completed the onboarding wizard yet. */
export async function isFirstInstall(shop: string): Promise<boolean> {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  return settings === null || settings.onboardingCompletedAt === null;
}

export const NotificationService = {
  /**
   * Returns the monthly email cap for a given plan.
   * Defaults to FREE limit for unknown plans.
   */
  planLimit(plan: string): number {
    return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
  },

  /**
   * Counts NotificationLog rows for the shop in the current calendar month
   * where status != "SKIPPED".
   */
  async monthlyCount(shop: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return prisma.notificationLog.count({
      where: {
        shop,
        status: { not: "SKIPPED" },
        sentAt: { gte: monthStart, lt: monthEnd },
      },
    });
  },

  /**
   * Sends restock notifications for all PENDING subscribers of a given variant.
   */
  async sendRestock(opts: {
    shop: string;
    variantId: string;
    admin?: AdminGraphQL;
  }): Promise<RestockResult> {
    const { shop, variantId, admin } = opts;

    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    const provider = getEmailProvider(settings);

    // If NoOpProvider (auto-send disabled), write SKIPPED logs and return
    if (provider instanceof NoOpProvider) {
      const pendingSubscribers = await SubscriberService.findByVariant({
        shop,
        variantId,
        status: "PENDING",
      });

      await prisma.notificationLog.createMany({
        data: pendingSubscribers.map((sub) => ({
          subscriberId: sub.id,
          shop,
          status: "SKIPPED",
        })),
      });

      return { sent: 0, skipped: pendingSubscribers.length, failed: 0 };
    }

    // Check plan limit before sending
    const plan = settings?.plan ?? "FREE";
    const limit = NotificationService.planLimit(plan);
    const current = await NotificationService.monthlyCount(shop);

    if (current >= limit) {
      throw new PlanLimitError(plan, limit, current);
    }

    const pendingSubscribers = await SubscriberService.findByVariant({
      shop,
      variantId,
      status: "PENDING",
    });

    const fromName = settings?.emailFromName ?? "Restock Alerts";
    const subject =
      settings?.emailSubject ?? "{{product_title}} is back in stock!";
    const template =
      settings?.emailBodyHtml ??
      '<p>Good news! <a href="{{product_url}}">{{product_title}}</a> is back in stock. Grab yours before it sells out!</p>';

    const { title: productTitle, url: productUrl } = admin
      ? await fetchProductInfo(admin, variantId, shop)
      : { title: "Your Product", url: `https://${shop}` };

    let sent = 0;
    let failed = 0;

    for (const sub of pendingSubscribers) {
      const html = buildEmailHtml(template, productTitle, productUrl);
      const resolvedSubject = buildEmailHtml(subject, productTitle, productUrl);

      try {
        await provider.send({
          to: sub.email,
          subject: resolvedSubject,
          html,
          fromName,
        });

        await prisma.subscriber.update({
          where: { id: sub.id },
          data: { status: "NOTIFIED", notifiedAt: new Date() },
        });

        await prisma.notificationLog.create({
          data: {
            subscriberId: sub.id,
            shop,
            status: "SENT",
          },
        });

        sent++;
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";

        await prisma.notificationLog.create({
          data: {
            subscriberId: sub.id,
            shop,
            status: "FAILED",
            errorMessage,
          },
        });

        failed++;
      }
    }

    return { sent, skipped: 0, failed };
  },

  /**
   * Sends a single test email to the given address.
   * Does NOT write to NotificationLog.
   */
  async sendTest(opts: { shop: string; toEmail: string }): Promise<void> {
    const { shop, toEmail } = opts;

    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    const provider = getEmailProvider(settings);
    const fromName = settings?.emailFromName ?? "Restock Alerts";
    const subject = "Test: Restock Alerts notification";
    const productTitle = "Test Product";
    const productUrl = "https://your-store.myshopify.com/products/test";
    const template =
      settings?.emailBodyHtml ??
      '<p>Good news! <a href="{{product_url}}">{{product_title}}</a> is back in stock. Grab yours before it sells out!</p>';

    const html = buildEmailHtml(template, productTitle, productUrl);

    await provider.send({ to: toEmail, subject, html, fromName });
  },
};
