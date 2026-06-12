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
  sendTestEmail,
  DEFAULT_SETTINGS,
} from "../services/notification.server";

function substituteTokens(html: string): string {
  return html
    .replace(/\{\{product_title\}\}/g, "Example Product")
    .replace(/\{\{product_url\}\}/g, "#");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = (await getShopSettings(shop)) ?? DEFAULT_SETTINGS;
  const previewHtml = substituteTokens(settings.emailBodyHtml);
  return { settings, previewHtml, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const testEmail = (formData.get("testEmail") as string | null)?.trim() ?? "";

  if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return { success: false, error: "Please enter a valid email address.", sentTo: null };
  }

  try {
    await sendTestEmail(shop, testEmail);
    return { success: true, error: null, sentTo: testEmail };
  } catch (err) {
    console.error("[preview] sendTestEmail failed:", err);
    return { success: false, error: "Failed to send email. Check that your Resend API key is set and your sending domain is verified.", sentTo: null };
  }
};

export default function PreviewPage() {
  const { settings, previewHtml, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSending = navigation.state === "submitting";

  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;

  return (
    <s-page heading="Test Email & Preview">
      <s-stack direction="block" gap="base">

        {actionData?.success && (
          <s-banner tone="success">
            <s-text>Test email sent to {actionData.sentTo}.</s-text>
          </s-banner>
        )}

        {actionData?.error && (
          <s-banner tone="critical">
            <s-text>Failed to send test email: {actionData.error}</s-text>
          </s-banner>
        )}

        {/* Email preview */}
        <s-section heading="Email preview">
          <s-stack direction="block" gap="base">
            <div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>From:</div>
              <div>{settings.emailFromName}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Subject:</div>
              <div>{substituteTokens(settings.emailSubject)}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Body:</div>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                  style={{ fontFamily: "sans-serif", lineHeight: 1.6 }}
                />
              </s-box>
            </div>
            <s-text>
              Preview uses dummy values: product_title = &quot;Example Product&quot;, product_url =
              &quot;#&quot;
            </s-text>
          </s-stack>
        </s-section>

        {/* Send test email */}
        <s-section heading="Send a test email">
          <s-stack direction="block" gap="base">
            <s-text>
              Enter an email address to receive a test notification and verify your template looks correct.
            </s-text>
            <Form method="post">
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Send test to"
                  id="testEmail"
                  name="testEmail"
                  placeholder="you@example.com"
                />
                <div>
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(isSending ? { loading: true } : {})}
                  >
                    Send test email
                  </s-button>
                </div>
              </s-stack>
            </Form>
          </s-stack>
        </s-section>

        {/* Widget link */}
        <s-section heading="Widget appearance">
          <s-stack direction="block" gap="base">
            <s-text>
              Customize how the &quot;Notify Me&quot; widget looks on your product pages in the
              theme editor.
            </s-text>
            <s-link href={themeEditorUrl} target="_blank">
              <s-button variant="secondary">Open theme editor</s-button>
            </s-link>
          </s-stack>
        </s-section>

      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
