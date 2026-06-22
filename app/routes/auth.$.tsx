
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { isFirstInstall } from "../services/notification.server";
import { AppResendProvider } from "../services/email/AppResendProvider";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey && (await isFirstInstall(session.shop))) {
    new AppResendProvider(apiKey)
      .send({
        to: "torty.emmanuel@gmail.com",
        fromName: "Restock Alerts",
        subject: `New install: ${session.shop}`,
        html: `
          <p>A new merchant just installed Restock Alerts.</p>
          <p><strong>Shop:</strong> ${session.shop}</p>
          <p><strong>Time:</strong> ${new Date().toUTCString()}</p>
          <p>Reach out to welcome them. In 7 days they'll see the in-app review prompt.</p>
        `,
      })
      .catch((err) => console.error("[install-notify] email failed:", err));
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
