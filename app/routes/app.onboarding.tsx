import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, Form, useNavigation } from "react-router";
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

function Step1({
  settings,
  navigation,
}: {
  settings: ShopSettings;
  navigation: ReturnType<typeof useNavigation>;
}) {
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="Set up your email notifications">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text>
            Configure how your back-in-stock emails look. You can change these later in Settings.
          </s-text>

          <Form method="post">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="step" value="1" />

              {/* Auto-send toggle */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>
                  Automatically send emails when items restock
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    id="autoSendEnabled"
                    type="checkbox"
                    name="autoSendEnabled"
                    value="true"
                    defaultChecked={settings.autoSendEnabled}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <label htmlFor="autoSendEnabled" style={{ fontSize: "14px" }}>
                    Recommended — emails fire automatically when a variant comes back in stock.
                  </label>
                </div>
              </div>

              {/* Email from name */}
              <s-text-field
                label="Email from name"
                id="emailFromName"
                name="emailFromName"
                value={settings.emailFromName}
                placeholder="Your Store"
              />

              {/* Email subject */}
              <s-text-field
                label="Email subject"
                id="emailSubject"
                name="emailSubject"
                value={settings.emailSubject}
                placeholder="{{product_title}} is back in stock!"
                details="Available tokens: {{product_title}}, {{product_url}}"
              />

              {/* Email body */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Email body (HTML)</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px" }}>
                  Available tokens: <code>{"{{product_title}}"}</code>,{" "}
                  <code>{"{{product_url}}"}</code>
                </div>
                <textarea
                  id="emailBodyHtml"
                  name="emailBodyHtml"
                  rows={8}
                  defaultValue={settings.emailBodyHtml}
                  style={{
                    width: "100%",
                    padding: "8px",
                    fontFamily: "monospace",
                    fontSize: "13px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <s-button
                type="submit"
                variant="primary"
                {...(isSaving ? { loading: true } : {})}
              >
                Save &amp; Continue
              </s-button>
            </s-stack>
          </Form>

          <Form method="post">
            <input type="hidden" name="step" value="skip" />
            <button
              type="submit"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#005bd3",
                textDecoration: "underline",
                fontSize: "14px",
                padding: 0,
              }}
            >
              Skip setup — use defaults
            </button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Step2({ shop }: { shop: string }) {
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;

  const steps = [
    "Go to your Shopify theme editor",
    "Navigate to a product page template",
    'Click "Add block" and search for "Back in Stock — Notify Me"',
    "Save your theme",
  ];

  return (
    <s-page heading="Add the Notify Me widget to your store">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text>
            The widget shows a &quot;Notify Me&quot; button on out-of-stock product pages. Follow
            these steps to add it:
          </s-text>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <div
                  style={{
                    minWidth: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    backgroundColor: "#f1f1f1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "14px",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ paddingTop: "4px" }}>{step}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <s-link href={themeEditorUrl} target="_blank">
              <s-button variant="secondary">Open theme editor</s-button>
            </s-link>
          </div>

          <Form method="post">
            <input type="hidden" name="step" value="done" />
            <s-button type="submit" variant="primary">
              Done — go to dashboard
            </s-button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export default function OnboardingPage() {
  const { step, settings, shop } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (step === 2) {
    return <Step2 shop={shop} />;
  }

  return <Step1 settings={settings} navigation={navigation} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
