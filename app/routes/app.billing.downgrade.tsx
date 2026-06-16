import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveShopSettings } from "../services/notification.server";

const ACTIVE_SUBSCRIPTION = `#graphql
  query ActiveSubscription {
    currentAppInstallation {
      activeSubscriptions { id }
    }
  }
`;

const CANCEL_SUBSCRIPTION = `#graphql
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors { field message }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  const response = await admin.graphql(ACTIVE_SUBSCRIPTION);
  const json = await response.json();
  const subId = json?.data?.currentAppInstallation?.activeSubscriptions?.[0]?.id;

  if (subId) {
    await admin.graphql(CANCEL_SUBSCRIPTION, { variables: { id: subId } });
  }

  await saveShopSettings(session.shop, { plan: "FREE" });

  throw redirect("/app/billing");
};
