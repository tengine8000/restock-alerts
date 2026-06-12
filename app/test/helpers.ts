import type {
  Subscriber,
  ShopSettings,
  NotificationLog,
} from "@prisma/client";

export function makeSubscriber(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    id: "sub_test_1",
    shop: "test-shop.myshopify.com",
    productId: "gid://shopify/Product/123",
    variantId: "gid://shopify/ProductVariant/456",
    email: "test@example.com",
    status: "PENDING",
    subscribedAt: new Date("2024-01-01T00:00:00Z"),
    notifiedAt: null,
    ...overrides,
  };
}

export function makeShopSettings(
  overrides: Partial<ShopSettings> = {}
): ShopSettings {
  return {
    shop: "test-shop.myshopify.com",
    plan: "FREE",
    autoSendEnabled: true,
    emailFromName: "Restock Alerts",
    emailSubject: "{{product_title}} is back in stock!",
    emailBodyHtml:
      '<p>Good news! <a href="{{product_url}}">{{product_title}}</a> is back in stock.</p>',
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeNotificationLog(
  overrides: Partial<NotificationLog> = {}
): NotificationLog {
  return {
    id: "log_test_1",
    subscriberId: "sub_test_1",
    shop: "test-shop.myshopify.com",
    status: "SENT",
    errorMessage: null,
    providerName: null,
    sentAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}
