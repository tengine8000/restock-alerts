import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
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
  return { apiKey: process.env.SHOPIFY_API_KEY || "", pendingCount: stats.pending };
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function App() {
  const { apiKey, pendingCount } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">
          Dashboard{pendingCount > 0 && (
            <s-badge tone="warning">{formatCount(pendingCount)}</s-badge>
          )}
        </s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/preview">Test Email</s-link>
        <s-link href="/app/billing">Plans</s-link>
      </s-app-nav>
      <Outlet />
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
