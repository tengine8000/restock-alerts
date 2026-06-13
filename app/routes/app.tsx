import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { isFirstInstall } from "../services/notification.server";
import { getSubscriberStats } from "../services/subscriber.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const firstInstall = await isFirstInstall(session.shop);
  if (firstInstall) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/app/onboarding")) {
      throw redirect("/app/onboarding");
    }
  }

  const stats = await getSubscriberStats(session.shop);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    pendingCount: stats.pending,
    shop: session.shop,
    tawkPropertyId: process.env.TAWK_PROPERTY_ID || "",
    tawkWidgetId: process.env.TAWK_WIDGET_ID || "default",
  };
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Tawk.to chat widget ───────────────────────────────────────────────────────

function TawkChat({ propertyId, widgetId, shop }: { propertyId: string; widgetId: string; shop: string }) {
  useEffect(() => {
    if (!propertyId) return;

    const w = window as any;
    w.Tawk_API = w.Tawk_API || {};
    w.Tawk_LoadStart = new Date();

    // Pre-fill merchant shop domain so support has immediate context
    w.Tawk_API.onLoad = function () {
      w.Tawk_API.setAttributes({ shop }, function () {});
    };

    const script = document.createElement("script");
    const first = document.getElementsByTagName("script")[0];
    script.async = true;
    script.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
    script.charset = "UTF-8";
    script.setAttribute("crossorigin", "*");
    first.parentNode?.insertBefore(script, first);

    return () => { script.remove(); };
  }, [propertyId, widgetId, shop]);

  return null;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function App() {
  const { apiKey, pendingCount, shop, tawkPropertyId, tawkWidgetId } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">
          {pendingCount > 0 ? `Dashboard (${formatCount(pendingCount)})` : "Dashboard"}
        </s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Plans</s-link>
      </s-app-nav>
      <Outlet />
      <TawkChat propertyId={tawkPropertyId} widgetId={tawkWidgetId} shop={shop} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
