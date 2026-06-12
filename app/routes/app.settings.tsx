import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, Form, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  saveShopSettings,
  DEFAULT_SETTINGS,
  PLAN_LIMITS,
} from "../services/notification.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = (await getShopSettings(shop)) ?? DEFAULT_SETTINGS;
  const planLimit = PLAN_LIMITS[settings.plan] ?? PLAN_LIMITS["FREE"];
  return { settings, planLimit };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const emailFromName = (formData.get("emailFromName") as string | null) ?? "";
  const emailSubject = (formData.get("emailSubject") as string | null) ?? "";
  const emailBodyHtml = (formData.get("emailBodyHtml") as string | null) ?? "";
  const autoSendEnabled = formData.get("autoSendEnabled") === "true";

  if (!emailFromName.trim()) {
    return { error: "Email from name is required.", success: false };
  }
  if (emailFromName.trim().length > 255) {
    return { error: "From name is too long (max 255 characters).", success: false };
  }
  if (emailSubject.trim().length > 500) {
    return { error: "Subject line is too long (max 500 characters).", success: false };
  }
  if (emailBodyHtml.length > 50_000) {
    return { error: "Email body is too long (max 50,000 characters).", success: false };
  }

  await saveShopSettings(shop, {
    autoSendEnabled,
    emailFromName: emailFromName.trim(),
    emailSubject: emailSubject.trim(),
    emailBodyHtml,
  });

  return { success: true, error: null };
};

export default function SettingsPage() {
  const { settings, planLimit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="Email Settings">
      <s-stack direction="block" gap="base">

        {actionData?.success && (
          <s-banner tone="success">
            <s-text>Settings saved successfully.</s-text>
          </s-banner>
        )}

        {actionData?.error && (
          <s-banner tone="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        )}

        <Form method="post">
          <s-section heading="Notification settings">
            <s-stack direction="block" gap="base">

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
                    When enabled, subscribers are emailed automatically when their watched variant
                    comes back in stock.
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
                details="This is the sender name subscribers will see in their inbox."
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
                  rows={10}
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
                Save settings
              </s-button>
            </s-stack>
          </s-section>
        </Form>

        {/* Plan info */}
        <s-section heading="Current plan">
          <s-stack direction="block" gap="base">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text>
                You are on the <strong>{settings.plan}</strong> plan — up to{" "}
                <strong>{planLimit}</strong> notification emails per month.
              </s-text>
              <s-link href="#">Upgrade plan</s-link>
            </div>
            <s-text>
              Upgrading gives you higher send limits and priority support.
            </s-text>
          </s-stack>
        </s-section>

      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
