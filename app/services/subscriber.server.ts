import type { Subscriber } from "@prisma/client";
import prisma from "~/db.server";

export type { Subscriber };

export interface CreateSubscriberInput {
  shop: string;
  productId: string;
  variantId: string;
  productTitle?: string;
  variantTitle?: string;
  email: string;
}

export interface FindAllOptions {
  shop: string;
  productId?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: "subscribedAt_asc" | "subscribedAt_desc";
  page?: number;
  pageSize?: number;
}

export interface FindAllResult {
  subscribers: Subscriber[];
  total: number;
}

export const SubscriberService = {
  /**
   * Upsert: if (shop, variantId, email) exists → reset status to PENDING, clear notifiedAt.
   * Otherwise insert new subscriber.
   */
  async create(input: CreateSubscriberInput): Promise<Subscriber> {
    const { shop, productId, variantId, productTitle, variantTitle, email } = input;

    return prisma.subscriber.upsert({
      where: { shop_variantId_email: { shop, variantId, email } },
      create: {
        shop,
        productId,
        variantId,
        productTitle: productTitle ?? null,
        variantTitle: variantTitle ?? null,
        email,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        notifiedAt: null,
        subscribedAt: new Date(),
        ...(productTitle ? { productTitle } : {}),
        ...(variantTitle ? { variantTitle } : {}),
      },
    });
  },

  /**
   * Returns subscribers filtered by shop + variantId, optionally by status.
   */
  async findByVariant(opts: {
    shop: string;
    variantId: string;
    status?: string;
  }): Promise<Subscriber[]> {
    const { shop, variantId, status } = opts;

    return prisma.subscriber.findMany({
      where: {
        shop,
        variantId,
        ...(status ? { status } : {}),
      },
    });
  },

  /**
   * Paginated + filtered query across all subscribers for a shop.
   */
  async findAll(opts: FindAllOptions): Promise<FindAllResult> {
    const {
      shop,
      productId,
      status,
      dateFrom,
      dateTo,
      sort = "subscribedAt_desc",
      page = 1,
      pageSize = 50,
    } = opts;

    const where = {
      shop,
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
      ...(dateFrom || dateTo
        ? {
            subscribedAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const orderBy =
      sort === "subscribedAt_asc"
        ? { subscribedAt: "asc" as const }
        : { subscribedAt: "desc" as const };

    const skip = (page - 1) * pageSize;

    const [subscribers, total] = await Promise.all([
      prisma.subscriber.findMany({ where, orderBy, skip, take: pageSize }),
      prisma.subscriber.count({ where }),
    ]);

    return { subscribers, total };
  },

  /**
   * Sets the subscriber status to UNSUBSCRIBED.
   */
  async unsubscribe(opts: {
    shop: string;
    variantId: string;
    email: string;
  }): Promise<void> {
    const { shop, variantId, email } = opts;

    await prisma.subscriber.updateMany({
      where: { shop, variantId, email },
      data: { status: "UNSUBSCRIBED" },
    });
  },

  /**
   * Yields CSV rows as strings. First yield is the header row.
   * Streams results to avoid loading all rows into memory.
   */
  async *exportCsv(opts: {
    shop: string;
    productId?: string;
    status?: string;
  }): AsyncGenerator<string> {
    const { shop, productId, status } = opts;

    yield "email,product_title,variant_title,product_id,variant_id,subscribed_at,status\n";

    const subscribers = await prisma.subscriber.findMany({
      where: {
        shop,
        ...(productId ? { productId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { subscribedAt: "asc" },
    });

    for (const sub of subscribers) {
      const row = [
        escapeCsvField(sub.email),
        escapeCsvField(sub.productTitle ?? ""),
        escapeCsvField(sub.variantTitle ?? ""),
        escapeCsvField(sub.productId),
        escapeCsvField(sub.variantId),
        sub.subscribedAt.toISOString(),
        escapeCsvField(sub.status),
      ].join(",");
      yield row + "\n";
    }
  },
};

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface ProductGroup {
  productId: string;
  productTitle: string;
  total: number;
  pending: number;
}

export async function getProductGroups(shop: string): Promise<ProductGroup[]> {
  const [allGroups, pendingGroups, titleRows] = await Promise.all([
    prisma.subscriber.groupBy({
      by: ["productId"],
      where: { shop },
      _count: { _all: true },
      orderBy: { _count: { productId: "desc" } },
    }),
    prisma.subscriber.groupBy({
      by: ["productId"],
      where: { shop, status: "PENDING" },
      _count: { _all: true },
    }),
    prisma.subscriber.findMany({
      where: { shop },
      select: { productId: true, productTitle: true },
      distinct: ["productId"],
    }),
  ]);

  const pendingMap = new Map(pendingGroups.map((g) => [g.productId, g._count._all]));
  const titleMap = new Map(titleRows.map((r) => [r.productId, r.productTitle]));

  return allGroups.map((g) => ({
    productId: g.productId,
    productTitle: titleMap.get(g.productId) ?? `Product #${g.productId}`,
    total: g._count._all,
    pending: pendingMap.get(g.productId) ?? 0,
  }));
}

export interface SubscriberStats {
  total: number;
  pending: number;
  notified: number;
  sentThisMonth: number;
}

/** Returns aggregate subscriber counts for a shop. */
export async function getSubscriberStats(
  shop: string
): Promise<SubscriberStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, pending, notified, sentThisMonth] = await Promise.all([
    prisma.subscriber.count({ where: { shop } }),
    prisma.subscriber.count({ where: { shop, status: "PENDING" } }),
    prisma.subscriber.count({ where: { shop, status: "NOTIFIED" } }),
    prisma.notificationLog.count({
      where: {
        shop,
        status: "SENT",
        sentAt: { gte: monthStart },
      },
    }),
  ]);

  return { total, pending, notified, sentThisMonth };
}

/** Alias for SubscriberService.findAll — used by UI routes. */
export async function findAllSubscribers(
  opts: FindAllOptions
): Promise<FindAllResult> {
  return SubscriberService.findAll(opts);
}

/** Alias for SubscriberService.exportCsv — used by UI routes. */
export function exportSubscribersCsv(opts: {
  shop: string;
  productId?: string;
  status?: string;
}): AsyncGenerator<string> {
  return SubscriberService.exportCsv(opts);
}
