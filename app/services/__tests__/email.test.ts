import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../test/setup";
import {
  getEmailProvider,
  NoOpProvider,
  ConsoleProvider,
  AppResendProvider,
} from "../email/index";
import { makeShopSettings } from "../../test/helpers";

// ─────────────────────────────────────────────────────────────────────────────
describe("getEmailProvider() factory", () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.RESEND_API_KEY = originalApiKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("returns NoOpProvider when autoSendEnabled is false", () => {
    const settings = makeShopSettings({ autoSendEnabled: false });
    const provider = getEmailProvider(settings);
    expect(provider).toBeInstanceOf(NoOpProvider);
  });

  it("returns NoOpProvider when settings is null-ish with autoSendEnabled false explicitly", () => {
    // settings with autoSendEnabled: false takes priority regardless of API key
    process.env.RESEND_API_KEY = "re_test_key";
    const settings = makeShopSettings({ autoSendEnabled: false });
    const provider = getEmailProvider(settings);
    expect(provider).toBeInstanceOf(NoOpProvider);
  });

  it("returns AppResendProvider when RESEND_API_KEY is set and autoSendEnabled is true", () => {
    process.env.RESEND_API_KEY = "re_test_abc123";
    const settings = makeShopSettings({ autoSendEnabled: true });
    const provider = getEmailProvider(settings);
    expect(provider).toBeInstanceOf(AppResendProvider);
  });

  it("returns ConsoleProvider when no RESEND_API_KEY and autoSendEnabled is true", () => {
    const settings = makeShopSettings({ autoSendEnabled: true });
    const provider = getEmailProvider(settings);
    expect(provider).toBeInstanceOf(ConsoleProvider);
  });

  it("returns ConsoleProvider when settings is null and no API key", () => {
    const provider = getEmailProvider(null);
    // null settings → autoSendEnabled is falsy... but null means use defaults
    // Per the factory: null → no explicit false, check API key → none → ConsoleProvider
    expect(provider).toBeInstanceOf(ConsoleProvider);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("AppResendProvider.send()", () => {
  it("makes a POST request to the Resend API with correct payload", async () => {
    let capturedBody: unknown = null;

    mswServer.use(
      http.post("https://api.resend.com/emails", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: "email_123" }, { status: 200 });
      })
    );

    const provider = new AppResendProvider("re_test_key");
    await provider.send({
      to: "buyer@example.com",
      subject: "Your item is back!",
      html: "<p>It is back!</p>",
      fromName: "My Shop",
    });

    expect(capturedBody).toMatchObject({
      to: ["buyer@example.com"],
      subject: "Your item is back!",
      html: "<p>It is back!</p>",
    });
  });

  it("throws when Resend API returns non-2xx status", async () => {
    mswServer.use(
      http.post("https://api.resend.com/emails", () => {
        return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });
      })
    );

    const provider = new AppResendProvider("bad_key");

    await expect(
      provider.send({
        to: "buyer@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        fromName: "Shop",
      })
    ).rejects.toThrow("Resend API error: 401");
  });

  it("includes Authorization header with Bearer token", async () => {
    let capturedAuthHeader: string | null = null;

    mswServer.use(
      http.post("https://api.resend.com/emails", ({ request }) => {
        capturedAuthHeader = request.headers.get("Authorization");
        return HttpResponse.json({ id: "email_456" }, { status: 200 });
      })
    );

    const provider = new AppResendProvider("re_my_secret_key");
    await provider.send({
      to: "test@example.com",
      subject: "Subject",
      html: "<p>Hi</p>",
      fromName: "Store",
    });

    expect(capturedAuthHeader).toBe("Bearer re_my_secret_key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NoOpProvider.send()", () => {
  it("does not throw and logs intent", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = new NoOpProvider();

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        fromName: "Shop",
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ConsoleProvider.send()", () => {
  it("logs to stdout without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = new ConsoleProvider();

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "Subject",
        html: "<p>Body</p>",
        fromName: "Store",
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
