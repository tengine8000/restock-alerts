import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, Form, useNavigation } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  isFirstInstall,
  saveShopSettings,
  DEFAULT_SETTINGS,
  getShopSettings,
  type ShopSettings,
} from "../services/notification.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = session.shop;

  const firstInstall = await isFirstInstall(shop);
  if (!firstInstall) {
    throw redirect("/app");
  }

  const url = new URL(request.url);
  const step = parseInt(url.searchParams.get("step") ?? "1", 10);
  const settings = (await getShopSettings(shop)) ?? DEFAULT_SETTINGS;

  return { step, settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const step = formData.get("step") as string;

  if (step === "1") {
    const autoSendEnabled = formData.get("autoSendEnabled") === "true";
    const emailFromName =
      (formData.get("emailFromName") as string | null) ?? DEFAULT_SETTINGS.emailFromName;
    const emailSubject =
      (formData.get("emailSubject") as string | null) ?? DEFAULT_SETTINGS.emailSubject;
    const emailBodyHtml =
      (formData.get("emailBodyHtml") as string | null) ?? DEFAULT_SETTINGS.emailBodyHtml;

    await saveShopSettings(shop, {
      autoSendEnabled,
      emailFromName: emailFromName.trim() || DEFAULT_SETTINGS.emailFromName,
      emailSubject: emailSubject.trim() || DEFAULT_SETTINGS.emailSubject,
      emailBodyHtml,
    });

    throw redirect("/app/onboarding?step=2");
  }

  if (step === "skip") {
    await saveShopSettings(shop, {
      autoSendEnabled: DEFAULT_SETTINGS.autoSendEnabled,
      emailFromName: DEFAULT_SETTINGS.emailFromName,
      emailSubject: DEFAULT_SETTINGS.emailSubject,
      emailBodyHtml: DEFAULT_SETTINGS.emailBodyHtml,
    });
    throw redirect("/app/onboarding?step=2");
  }

  if (step === "done") {
    throw redirect("/app");
  }

  throw redirect("/app/onboarding?step=1");
};

// ─── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #e4e5e7",
  borderRadius: "10px", padding: "28px 32px",
};

const divider: React.CSSProperties = {
  height: "1px", background: "#f1f2f3", margin: "20px 0",
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
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transition: "left 0.2s",
      }} />
    </div>
  );
}

// ─── Progress indicator ────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "24px" }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "28px", height: "28px", borderRadius: "50%",
            background: current >= n ? "#008060" : "#e4e5e7",
            color: current >= n ? "#fff" : "#8c9196",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "13px", fontWeight: 700, flexShrink: 0,
          }}>
            {current > n ? "✓" : n}
          </div>
          {n < total && (
            <div style={{
              width: "32px", height: "2px",
              background: current > n ? "#008060" : "#e4e5e7",
            }} />
          )}
        </div>
      ))}
      <span style={{ fontSize: "13px", color: "#6d7175", marginLeft: "4px" }}>
        Step {current} of {total}
      </span>
    </div>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({ settings, navigation }: { settings: ShopSettings; navigation: ReturnType<typeof useNavigation> }) {
  const isSaving = navigation.state === "submitting";
  const [autoSend, setAutoSend] = useState(settings.autoSendEnabled);

  return (
    <s-page heading="Welcome to Restock Alerts">
      <div style={{ maxWidth: "640px" }}>
        <StepIndicator current={1} total={2} />
        <div style={card}>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#202223", marginBottom: "4px" }}>
            Set up your email notifications
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "4px" }}>
            Configure how restock alerts look to your subscribers. You can change these any time in Settings.
          </div>
          <div style={divider} />

          <Form method="post">
            <input type="hidden" name="step" value="1" />
            <input type="hidden" name="autoSendEnabled" value={autoSend ? "true" : "false"} />

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Auto-send toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223", marginBottom: "2px" }}>
                    Auto-send emails
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175" }}>
                    Recommended — emails fire automatically when a variant comes back in stock.
                  </div>
                </div>
                <ToggleSwitch checked={autoSend} onChange={setAutoSend} />
              </div>

              <div style={divider} />

              {/* Email from name */}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "#6d7175", marginBottom: "4px" }}>Email from name</div>
                <input
                  name="emailFromName"
                  defaultValue={settings.emailFromName}
                  placeholder="Your Store"
                  style={{
                    width: "100%", padding: "8px 10px", fontSize: "14px",
                    border: "1px solid #c9cccf", borderRadius: "6px",
                    color: "#202223", boxSizing: "border-box", outline: "none",
                  }}
                />
              </div>

              {/* Email subject */}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "#6d7175", marginBottom: "4px" }}>Email subject</div>
                <input
                  name="emailSubject"
                  defaultValue={settings.emailSubject}
                  placeholder="{{product_title}} is back in stock!"
                  style={{
                    width: "100%", padding: "8px 10px", fontSize: "14px",
                    border: "1px solid #c9cccf", borderRadius: "6px",
                    color: "#202223", boxSizing: "border-box", outline: "none",
                  }}
                />
                <div style={{ fontSize: "12px", color: "#8c9196", marginTop: "4px" }}>
                  Tokens: <code style={{ background: "#f1f2f3", padding: "1px 4px", borderRadius: "3px" }}>{"{{product_title}}"}</code>{" "}
                  <code style={{ background: "#f1f2f3", padding: "1px 4px", borderRadius: "3px" }}>{"{{product_url}}"}</code>
                </div>
              </div>

              {/* Email body */}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "#6d7175", marginBottom: "4px" }}>Email body (HTML)</div>
                <textarea
                  name="emailBodyHtml"
                  rows={8}
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
              </div>

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
                  Save &amp; Continue
                </s-button>
                <Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="step" value="skip" />
                  <button type="submit" style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#6d7175", fontSize: "13px", padding: 0,
                  }}>
                    Skip — use defaults
                  </button>
                </Form>
              </div>

            </div>
          </Form>
        </div>
      </div>
    </s-page>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({ shop }: { shop: string }) {
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;

  const steps = [
    { label: "Open your Shopify theme editor", detail: "Click the button below to go directly there." },
    { label: "Navigate to a product page template", detail: 'Select a product template in the left sidebar.' },
    { label: 'Add the "Restock Alerts" block', detail: 'Click "Add block" and search for "Restock Alerts".' },
    { label: "Save your theme", detail: "Click Save — the Notify Me widget is now live." },
  ];

  return (
    <s-page heading="Welcome to Restock Alerts">
      <div style={{ maxWidth: "640px" }}>
        <StepIndicator current={2} total={2} />
        <div style={card}>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#202223", marginBottom: "4px" }}>
            Add the Notify Me widget to your store
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            The widget shows a &ldquo;Notify Me&rdquo; button on out-of-stock product pages. Takes about 2 minutes.
          </div>
          <div style={divider} />

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                  background: "#f1f2f3", border: "1px solid #e4e5e7",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "13px", color: "#202223",
                }}>
                  {i + 1}
                </div>
                <div style={{ paddingTop: "4px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#202223" }}>{s.label}</div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>{s.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <s-link href={themeEditorUrl} target="_blank">
              <s-button variant="secondary">Open theme editor</s-button>
            </s-link>
            <Form method="post">
              <input type="hidden" name="step" value="done" />
              <s-button type="submit" variant="primary">
                Done — go to dashboard
              </s-button>
            </Form>
          </div>
        </div>
      </div>
    </s-page>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { step, settings, shop } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (step === 2) return <Step2 shop={shop} />;
  return <Step1 settings={settings} navigation={navigation} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
