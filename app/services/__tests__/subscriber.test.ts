import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoist mock objects so they're available in the vi.mock factory ────────────
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    subscriber: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));

import { SubscriberService } from "../subscriber.server";
import { makeSubscriber } from "../../test/helpers";

const SHOP = "test-shop.myshopify.com";
const VARIANT_ID = "gid://shopify/ProductVariant/456";
const PRODUCT_ID = "gid://shopify/Product/123";
const EMAIL = "alice@example.com";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SubscriberService.create()", () => {
  it("inserts a new subscriber with PENDING status", async () => {
    const expected = makeSubscriber({ email: EMAIL });
    mockPrisma.subscriber.upsert.mockResolvedValue(expected);

    const result = await SubscriberService.create({
      shop: SHOP,
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      email: EMAIL,
    });

    expect(mockPrisma.subscriber.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.subscriber.upsert.mock.calls[0][0];
    expect(call.create.status).toBe("PENDING");
    expect(call.create.email).toBe(EMAIL);
    expect(result).toEqual(expected);
  });

  it("re-subscribes by resetting status to PENDING and clearing notifiedAt", async () => {
    const existing = makeSubscriber({ status: "NOTIFIED", notifiedAt: new Date() });
    mockPrisma.subscriber.upsert.mockResolvedValue({
      ...existing,
      status: "PENDING",
      notifiedAt: null,
    });

    await SubscriberService.create({
      shop: SHOP,
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      email: EMAIL,
    });

    const call = mockPrisma.subscriber.upsert.mock.calls[0][0];
    expect(call.update.status).toBe("PENDING");
    expect(call.update.notifiedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SubscriberService.findByVariant()", () => {
  it("returns subscribers filtered by shop and variantId", async () => {
    const subs = [makeSubscriber({ email: "a@x.com" }), makeSubscriber({ email: "b@x.com" })];
    mockPrisma.subscriber.findMany.mockResolvedValue(subs);

    const result = await SubscriberService.findByVariant({ shop: SHOP, variantId: VARIANT_ID });

    expect(result).toEqual(subs);
    expect(mockPrisma.subscriber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shop: SHOP, variantId: VARIANT_ID }),
      })
    );
  });

  it("passes status filter when provided", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);

    await SubscriberService.findByVariant({ shop: SHOP, variantId: VARIANT_ID, status: "PENDING" });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("PENDING");
  });

  it("does not add status filter when status is omitted", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);

    await SubscriberService.findByVariant({ shop: SHOP, variantId: VARIANT_ID });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty("status");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SubscriberService.findAll()", () => {
  it("returns paginated results with total count", async () => {
    const subs = [makeSubscriber()];
    mockPrisma.subscriber.findMany.mockResolvedValue(subs);
    mockPrisma.subscriber.count.mockResolvedValue(42);

    const result = await SubscriberService.findAll({ shop: SHOP, page: 2, pageSize: 10 });

    expect(result.subscribers).toEqual(subs);
    expect(result.total).toBe(42);

    const findCall = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(findCall.skip).toBe(10); // (page 2 - 1) * 10
    expect(findCall.take).toBe(10);
  });

  it("applies productId filter when provided", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);
    mockPrisma.subscriber.count.mockResolvedValue(0);

    await SubscriberService.findAll({ shop: SHOP, productId: PRODUCT_ID });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.where.productId).toBe(PRODUCT_ID);
  });

  it("applies status filter when provided", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);
    mockPrisma.subscriber.count.mockResolvedValue(0);

    await SubscriberService.findAll({ shop: SHOP, status: "NOTIFIED" });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("NOTIFIED");
  });

  it("defaults to descending subscribedAt sort", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);
    mockPrisma.subscriber.count.mockResolvedValue(0);

    await SubscriberService.findAll({ shop: SHOP });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ subscribedAt: "desc" });
  });

  it("supports ascending subscribedAt sort", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);
    mockPrisma.subscriber.count.mockResolvedValue(0);

    await SubscriberService.findAll({ shop: SHOP, sort: "subscribedAt_asc" });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ subscribedAt: "asc" });
  });

  it("applies date range filters when provided", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);
    mockPrisma.subscriber.count.mockResolvedValue(0);

    const dateFrom = new Date("2024-01-01");
    const dateTo = new Date("2024-12-31");

    await SubscriberService.findAll({ shop: SHOP, dateFrom, dateTo });

    const call = mockPrisma.subscriber.findMany.mock.calls[0][0];
    expect(call.where.subscribedAt).toEqual({ gte: dateFrom, lte: dateTo });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SubscriberService.unsubscribe()", () => {
  it("sets subscriber status to UNSUBSCRIBED", async () => {
    mockPrisma.subscriber.updateMany.mockResolvedValue({ count: 1 });

    await SubscriberService.unsubscribe({ shop: SHOP, variantId: VARIANT_ID, email: EMAIL });

    expect(mockPrisma.subscriber.updateMany).toHaveBeenCalledWith({
      where: { shop: SHOP, variantId: VARIANT_ID, email: EMAIL },
      data: { status: "UNSUBSCRIBED" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("SubscriberService.exportCsv()", () => {
  it("yields header row first, then subscriber data rows", async () => {
    const sub = makeSubscriber({
      email: "alice@example.com",
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/2",
      status: "NOTIFIED",
      subscribedAt: new Date("2024-06-01T12:00:00Z"),
    });
    mockPrisma.subscriber.findMany.mockResolvedValue([sub]);

    const rows: string[] = [];
    for await (const row of SubscriberService.exportCsv({ shop: SHOP })) {
      rows.push(row);
    }

    expect(rows[0]).toBe("email,product_id,variant_id,subscribed_at,status\n");
    expect(rows[1]).toContain("alice@example.com");
    expect(rows[1]).toContain("NOTIFIED");
    expect(rows[1]).toContain("2024-06-01T12:00:00.000Z");
  });

  it("escapes CSV fields that contain commas", async () => {
    const sub = makeSubscriber({ email: "alice,bob@example.com" });
    mockPrisma.subscriber.findMany.mockResolvedValue([sub]);

    const rows: string[] = [];
    for await (const row of SubscriberService.exportCsv({ shop: SHOP })) {
      rows.push(row);
    }

    expect(rows[1]).toContain('"alice,bob@example.com"');
  });

  it("yields only header when no subscribers found", async () => {
    mockPrisma.subscriber.findMany.mockResolvedValue([]);

    const rows: string[] = [];
    for await (const row of SubscriberService.exportCsv({ shop: SHOP })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe("email,product_id,variant_id,subscribed_at,status\n");
  });
});
