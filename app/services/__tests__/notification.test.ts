import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoist ALL shared values so vi.mock factories can reference them ───────────
const { mockPrisma, mockGetEmailProvider, MockNoOpProvider } = vi.hoisted(() => {
  // Inline NoOpProvider so the same class reference is used in the mock factory
  // AND in test code that does "new MockNoOpProvider()" for instanceof checks.
  class MockNoOpProvider {
    readonly name = "NoOpProvider";
    async send() {}
  }

  const mockPrisma = {
    shopSettings: { findUnique: vi.fn() },
    subscriber: { findMany: vi.fn(), update: vi.fn() },
    notificationLog: { count: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  };

  const mockGetEmailProvider = vi.fn();

  return { mockPrisma, mockGetEmailProvider, MockNoOpProvider };
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));

vi.mock("~/services/email/index", () => ({
  NoOpProvider: MockNoOpProvider,
  getEmailProvider: mockGetEmailProvider,
}));

import { NotificationService, PlanLimitError } from "../notification.server";
import { makeSubscriber, makeShopSettings } from "../../test/helpers";

const SHOP = "test-shop.myshopify.com";
const VARIANT_ID = "gid://shopify/ProductVariant/456";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.shopSettings.findUnique.mockResolvedValue(null);
  mockPrisma.notificationLog.count.mockResolvedValue(0);
  mockPrisma.notificationLog.create.mockResolvedValue({});
  mockPrisma.notificationLog.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.subscriber.findMany.mockResolvedValue([]);
  mockPrisma.subscriber.update.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NotificationService.planLimit()", () => {
  it("returns 100 for FREE", () => {
    expect(NotificationService.planLimit("FREE")).toBe(100);
  });

  it("returns 2000 for STARTER", () => {
    expect(NotificationService.planLimit("STARTER")).toBe(2000);
  });

  it("returns 8000 for GROWTH", () => {
    expect(NotificationService.planLimit("GROWTH")).toBe(8000);
  });

  it("returns 25000 for PRO", () => {
    expect(NotificationService.planLimit("PRO")).toBe(25000);
  });

  it("defaults to FREE limit for unknown plan", () => {
    expect(NotificationService.planLimit("UNKNOWN_PLAN")).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NotificationService.monthlyCount()", () => {
  it("counts non-SKIPPED logs for current month", async () => {
    mockPrisma.notificationLog.count.mockResolvedValue(42);

    const count = await NotificationService.monthlyCount(SHOP);

    expect(count).toBe(42);
    const call = mockPrisma.notificationLog.count.mock.calls[0][0];
    expect(call.where.shop).toBe(SHOP);
    expect(call.where.status).toEqual({ not: "SKIPPED" });
    expect(call.where.sentAt.gte).toBeInstanceOf(Date);
    expect(call.where.sentAt.lt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NotificationService.sendRestock()", () => {
  it("writes SKIPPED logs and returns counts when provider is NoOpProvider", async () => {
    const noOp = new MockNoOpProvider();
    mockGetEmailProvider.mockReturnValue(noOp);

    const subs = [
      makeSubscriber({ email: "a@x.com" }),
      makeSubscriber({ email: "b@x.com" }),
    ];
    mockPrisma.subscriber.findMany.mockResolvedValue(subs);

    const result = await NotificationService.sendRestock({ shop: SHOP, variantId: VARIANT_ID });

    expect(result).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(mockPrisma.notificationLog.createMany).toHaveBeenCalledOnce();
    const createManyCall = mockPrisma.notificationLog.createMany.mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(2);
    expect(createManyCall.data[0].status).toBe("SKIPPED");
    expect(createManyCall.data[1].status).toBe("SKIPPED");
  });

  it("throws PlanLimitError when monthly count is at/over plan limit", async () => {
    const settings = makeShopSettings({ plan: "FREE", autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    mockGetEmailProvider.mockReturnValue({ name: "ConsoleProvider", send: vi.fn() });

    // At the FREE limit of 100
    mockPrisma.notificationLog.count.mockResolvedValue(100);

    await expect(
      NotificationService.sendRestock({ shop: SHOP, variantId: VARIANT_ID })
    ).rejects.toThrow(PlanLimitError);
  });

  it("sends emails and marks subscribers NOTIFIED on success", async () => {
    const settings = makeShopSettings({ plan: "FREE", autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    const provider = { name: "ConsoleProvider", send: vi.fn().mockResolvedValue(undefined) };
    mockGetEmailProvider.mockReturnValue(provider);

    mockPrisma.notificationLog.count.mockResolvedValue(0);

    const subs = [
      makeSubscriber({ id: "sub1", email: "a@x.com" }),
      makeSubscriber({ id: "sub2", email: "b@x.com" }),
    ];
    mockPrisma.subscriber.findMany.mockResolvedValue(subs);

    const result = await NotificationService.sendRestock({ shop: SHOP, variantId: VARIANT_ID });

    expect(result).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(mockPrisma.subscriber.update).toHaveBeenCalledTimes(2);

    const update1 = mockPrisma.subscriber.update.mock.calls[0][0];
    expect(update1.data.status).toBe("NOTIFIED");
    expect(update1.data.notifiedAt).toBeInstanceOf(Date);
  });

  it("writes FAILED log and continues when provider.send throws", async () => {
    const settings = makeShopSettings({ plan: "FREE", autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    const provider = {
      name: "ConsoleProvider",
      send: vi.fn().mockRejectedValue(new Error("SMTP timeout")),
    };
    mockGetEmailProvider.mockReturnValue(provider);

    mockPrisma.notificationLog.count.mockResolvedValue(0);

    const subs = [makeSubscriber({ id: "sub1", email: "fail@x.com" })];
    mockPrisma.subscriber.findMany.mockResolvedValue(subs);

    const result = await NotificationService.sendRestock({ shop: SHOP, variantId: VARIANT_ID });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });

    const logCall = mockPrisma.notificationLog.create.mock.calls[0][0];
    expect(logCall.data.status).toBe("FAILED");
    expect(logCall.data.errorMessage).toBe("SMTP timeout");
    expect(mockPrisma.subscriber.update).not.toHaveBeenCalled();
  });

  it("returns { sent: 0, skipped: 0, failed: 0 } when no PENDING subscribers", async () => {
    const settings = makeShopSettings({ autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    const provider = { name: "ConsoleProvider", send: vi.fn() };
    mockGetEmailProvider.mockReturnValue(provider);

    mockPrisma.notificationLog.count.mockResolvedValue(0);
    mockPrisma.subscriber.findMany.mockResolvedValue([]);

    const result = await NotificationService.sendRestock({ shop: SHOP, variantId: VARIANT_ID });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NotificationService.sendTest()", () => {
  it("calls provider.send exactly once with test data", async () => {
    const settings = makeShopSettings({ autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    const provider = { name: "ConsoleProvider", send: vi.fn().mockResolvedValue(undefined) };
    mockGetEmailProvider.mockReturnValue(provider);

    await NotificationService.sendTest({ shop: SHOP, toEmail: "dev@example.com" });

    expect(provider.send).toHaveBeenCalledOnce();
    const call = provider.send.mock.calls[0][0];
    expect(call.to).toBe("dev@example.com");
    expect(call.html).toContain("Test Product");
  });

  it("does NOT write to NotificationLog", async () => {
    const settings = makeShopSettings({ autoSendEnabled: true });
    mockPrisma.shopSettings.findUnique.mockResolvedValue(settings);

    const provider = { name: "ConsoleProvider", send: vi.fn().mockResolvedValue(undefined) };
    mockGetEmailProvider.mockReturnValue(provider);

    await NotificationService.sendTest({ shop: SHOP, toEmail: "dev@example.com" });

    expect(mockPrisma.notificationLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PlanLimitError", () => {
  it("is instanceof Error and PlanLimitError", () => {
    const err = new PlanLimitError("FREE", 100, 100);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect(err.name).toBe("PlanLimitError");
    expect(err.plan).toBe("FREE");
    expect(err.limit).toBe(100);
    expect(err.current).toBe(100);
  });
});
