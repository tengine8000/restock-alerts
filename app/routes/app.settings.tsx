import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, Form, useActionData, useNavigation } from "react-router";
import { useState, useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  saveShopSettings,
  sendTestEmail,
  DEFAULT_SETTINGS,
  PLAN_LIMITS,
  reconcileShopPlan,
} from "../services/notification.server";

function substituteTokens(html: string): string {
  return html
    .replace(/\{\{product_title\}\}/g, "Example Product")
    .replace(/\{\{product_url\}\}/g, "#");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const [settings, { plan }] = await Promise.all([
    getShopSettings(shop),
    reconcileShopPlan(shop, admin.graphql.bind(admin)),
  ]);
  const resolvedSettings = settings ?? DEFAULT_SETTINGS;
  const planLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS["FREE"];
  const previewHtml = substituteTokens(resolvedSettings.emailBodyHtml);
  return { settings: resolvedSettings, plan, planLimit, previewHtml, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "send_test") {
    const testEmail = (formData.get("testEmail") as string | null)?.trim() ?? "";
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return { intent, success: false, error: "Please enter a valid email address.", sentTo: null };
    }
    try {
      await sendTestEmail(shop, testEmail);
      return { intent, success: true, error: null, sentTo: testEmail };
    } catch {
      return { intent, success: false, error: "Failed to send. Check your Resend API key and sending domain.", sentTo: null };
    }
  }

  // intent === "save"
  const emailFromName = (formData.get("emailFromName") as string | null) ?? "";
  const emailSubject = (formData.get("emailSubject") as string | null) ?? "";
  const emailBodyHtml = (formData.get("emailBodyHtml") as string | null) ?? "";
  const autoSendEnabled = formData.get("autoSendEnabled") === "true";

  if (!emailFromName.trim()) return { intent, error: "Email from name is required.", success: false, sentTo: null };
  if (emailFromName.trim().length > 255) return { intent, error: "From name is too long (max 255 characters).", success: false, sentTo: null };
  if (emailSubject.trim().length > 500) return { intent, error: "Subject line is too long (max 500 characters).", success: false, sentTo: null };
  if (emailBodyHtml.length > 50_000) return { intent, error: "Email body is too long (max 50,000 characters).", success: false, sentTo: null };

  await saveShopSettings(shop, {
    autoSendEnabled,
    emailFromName: emailFromName.trim(),
    emailSubject: emailSubject.trim(),
    emailBodyHtml,
  });

  return { intent, success: true, error: null, sentTo: null };
};

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange(!checked)}
      style={{
        width: "44px", height: "24px", borderRadius: "12px",
        background: checked ? "#008060" : "#c9cccf",
        position: "relative", cursor: "pointer", flexShrink: 0,
        transition: "background 0.2s", outline: "none",
      }}
    >
      <div style={{
        position: "absolute", top: "2px",
        left: checked ? "22px" : "2px",
        width: "20px", height: "20px", borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transition: "left 0.2s",
      }} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, plan, planLimit, previewHtml, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save";
  const isSending = navigation.state === "submitting" && navigation.formData?.get("intent") === "send_test";

  const [autoSend, setAutoSend] = useState(settings.autoSendEnabled);
  const [testPillDismissed, setTestPillDismissed] = useState(false);

  useEffect(() => { setTestPillDismissed(false); }, [actionData]);
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=restock-alerts-notify-me/notify-me&target=mainSection`;

  const planLabel = plan.charAt(0) + plan.slice(1).toLowerCase();

  return (
    <s-page heading="Settings">
      <s-stack direction="block" gap="base">

        {/* Save success/error */}
        {actionData?.intent === "save" && actionData.success && (
          <s-banner tone="success"><s-text>Settings saved.</s-text></s-banner>
        )}
        {actionData?.intent === "save" && actionData.error && (
          <s-banner tone="critical"><s-text>{actionData.error}</s-text></s-banner>
        )}

        {/* Test email success/error */}
        {actionData?.intent === "send_test" && actionData.success && (
          <s-banner tone="success"><s-text>Test email sent to <strong>{actionData.sentTo}</strong>.</s-text></s-banner>
        )}
        {actionData?.intent === "send_test" && actionData.error && (
          <s-banner tone="critical"><s-text>{actionData.error}</s-text></s-banner>
        )}

        {/* ── 1. Current plan ── */}
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Current plan</div>
        <s-section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ display: "flex", gap: "32px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Plan</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#202223" }}>{planLabel}</div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>Monthly email limit</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#202223" }}>{planLimit.toLocaleString()}</div>
              </div>
            </div>
            <s-link href="/app/billing">
              <s-button variant="secondary">Manage plan</s-button>
            </s-link>
          </div>
        </s-section>

        {/* ── 2. Notification settings ── */}
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Notification settings</div>
        <s-section>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="autoSendEnabled" value={autoSend ? "true" : "false"} />
            <s-stack direction="block" gap="base">

              {/* Auto-send toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223", marginBottom: "2px" }}>Auto-send emails</div>
                  <div style={{ fontSize: "13px", color: "#6d7175" }}>
                    Subscribers are emailed automatically the moment their watched variant comes back in stock.
                  </div>
                </div>
                <ToggleSwitch checked={autoSend} onChange={setAutoSend} />
              </div>

              <s-text-field
                label="Email from name"
                name="emailFromName"
                value={settings.emailFromName}
                placeholder="Your Store"
                details="The sender name subscribers will see in their inbox."
              />

              <s-text-field
                label="Email subject"
                name="emailSubject"
                value={settings.emailSubject}
                placeholder="{{product_title}} is back in stock!"
                details="Tokens: {{product_title}}, {{product_url}}"
              />

              {/* Email body — no s-textarea exists, keep custom */}
              <div>
                <div style={{ fontSize: "14px", fontWeight: 500, color: "#202223", marginBottom: "4px" }}>Email body (HTML)</div>
                <textarea
                  name="emailBodyHtml"
                  rows={10}
                  defaultValue={settings.emailBodyHtml}
                  style={{
                    width: "100%", padding: "8px 10px",
                    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                    fontSize: "13px", lineHeight: 1.5,
                    border: "1px solid #c9cccf", borderRadius: "6px",
                    color: "#202223", resize: "vertical",
                    boxSizing: "border-box", outline: "none",
                  }}
                />
                <div style={{ fontSize: "12px", color: "#8c9196", marginTop: "4px" }}>
                  Tokens:{" "}
                  <code style={{ background: "#f1f2f3", padding: "1px 5px", borderRadius: "3px" }}>{"{{product_title}}"}</code>{" "}
                  <code style={{ background: "#f1f2f3", padding: "1px 5px", borderRadius: "3px" }}>{"{{product_url}}"}</code>
                </div>
              </div>

              <div>
                <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
                  Save settings
                </s-button>
              </div>

            </s-stack>
          </Form>
        </s-section>

        {/* ── 3. Email preview & test ── */}
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Email preview & test</div>
        <s-section>
          <s-stack direction="block" gap="base">

            {/* Preview */}
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "10px" }}>
                Showing your saved template with dummy values — product_title = &ldquo;Example Product&rdquo;
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                <div style={{ display: "flex", gap: "8px", fontSize: "13px" }}>
                  <span style={{ fontWeight: 600, color: "#6d7175", minWidth: "56px" }}>From</span>
                  <span style={{ color: "#202223" }}>{settings.emailFromName}</span>
                </div>
                <div style={{ display: "flex", gap: "8px", fontSize: "13px" }}>
                  <span style={{ fontWeight: 600, color: "#6d7175", minWidth: "56px" }}>Subject</span>
                  <span style={{ color: "#202223" }}>{substituteTokens(settings.emailSubject)}</span>
                </div>
              </div>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                  style={{ fontFamily: "sans-serif", lineHeight: 1.6, fontSize: "14px" }}
                />
              </s-box>
            </div>

            {/* Test send */}
            <Form method="post">
              <input type="hidden" name="intent" value="send_test" />
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Send test to"
                    name="testEmail"
                    placeholder="you@example.com"
                  />
                </div>
                <div style={{ paddingBottom: "1px" }}>
                  <s-button type="submit" {...(isSending ? { loading: true } : {})}>
                    Send test
                  </s-button>
                </div>
              </div>

              {/* Inline toast — visible right next to the action, no scrolling needed */}
              {actionData?.intent === "send_test" && !testPillDismissed && (
                <div style={{
                  marginTop: "10px",
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  padding: "6px 10px 6px 12px", borderRadius: "20px",
                  background: actionData.success ? "#e6f4ea" : "#fff4f4",
                  border: `1px solid ${actionData.success ? "#8bc98b" : "#f4aaaa"}`,
                  color: actionData.success ? "#1a5c2a" : "#9e0404",
                  fontSize: "13px", fontWeight: 500,
                }}>
                  <span>{actionData.success ? "✓" : "✕"}</span>
                  <span>
                    {actionData.success ? `Sent to ${actionData.sentTo}` : actionData.error}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTestPillDismissed(true)}
                    aria-label="Dismiss"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "inherit", fontSize: "16px", lineHeight: 1,
                      padding: "0 2px", opacity: 0.6,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </Form>

          </s-stack>
        </s-section>

        {/* ── 4. Widget appearance ── */}
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Widget appearance</div>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Customise how the &ldquo;Notify Me&rdquo; button looks and where it appears on your product pages.
            </s-text>
            <div>
              <s-link href={themeEditorUrl} target="_blank">
                <s-button variant="secondary">Open theme editor</s-button>
              </s-link>
            </div>
          </s-stack>
        </s-section>

      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
