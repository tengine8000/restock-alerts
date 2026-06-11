import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getSubscriberStats,
  findAllSubscribers,
  type Subscriber,
} from "../services/subscriber.server";
import {
  getShopSettings,
  DEFAULT_SETTINGS,
  PLAN_LIMITS,
  NotificationService,
  PlanLimitError,
} from "../services/notification.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const sortParam = url.searchParams.get("sort") ?? "";
  const sort: "subscribedAt_asc" | "subscribedAt_desc" =
    sortParam === "subscribedAt_asc" ? "subscribedAt_asc" : "subscribedAt_desc";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = 50;

  const [stats, { subscribers, total }, settings] = await Promise.all([
    getSubscriberStats(shop),
    findAllSubscribers({
      shop,
      status: statusFilter || undefined,
      sort,
      page,
      pageSize,
    }),
    getShopSettings(shop),
  ]);

  const resolvedSettings = settings ?? DEFAULT_SETTINGS;
  const planLimit = PLAN_LIMITS[resolvedSettings.plan] ?? PLAN_LIMITS["FREE"];
  const emailsRemaining = Math.max(0, planLimit - stats.sentThisMonth);
  const planLimitReached = stats.sentThisMonth >= planLimit;

  return {
    stats,
    subscribers,
    total,
    statusFilter,
    sort,
    page,
    pageSize,
    autoSendEnabled: resolvedSettings.autoSendEnabled,
    plan: resolvedSettings.plan,
    planLimit,
    emailsRemaining,
    planLimitReached,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "send_now") {
    // Find all distinct variantIds that have at least one PENDING subscriber
    const pendingVariants = await import("../db.server").then(({ default: prisma }) =>
      prisma.subscriber.findMany({
        where: { shop, status: "PENDING" },
        select: { variantId: true },
        distinct: ["variantId"],
      })
    );

    if (pendingVariants.length === 0) {
      return { success: true, message: "No pending subscribers to notify." };
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const { variantId } of pendingVariants) {
      try {
        const result = await NotificationService.sendRestock({
          shop,
          variantId,
          admin: admin.graphql.bind(admin),
        });
        totalSent += result.sent;
        totalFailed += result.failed;
      } catch (err) {
        if (err instanceof PlanLimitError) {
          return {
            success: false,
            message: `Plan limit reached — ${totalSent} email(s) sent before the cap. Upgrade your plan to send more.`,
          };
        }
        totalFailed++;
      }
    }

    return {
      success: true,
      message: `Done — ${totalSent} email(s) sent${totalFailed > 0 ? `, ${totalFailed} failed` : ""}.`,
    };
  }

  return { success: false, message: "Unknown action" };
};

const statusStyle: Record<string, React.CSSProperties> = {
  PENDING: {
    backgroundColor: "#ffc453",
    color: "#3d2400",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-block",
  },
  NOTIFIED: {
    backgroundColor: "#b5e3b5",
    color: "#1a3c1a",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-block",
  },
  UNSUBSCRIBED: {
    backgroundColor: "#e4e5e7",
    color: "#6d7175",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-block",
  },
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={statusStyle[status] ?? statusStyle["PENDING"]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function SubscriberRow({ sub }: { sub: Subscriber }) {
  return (
    <tr style={{ borderBottom: "1px solid #e4e5e7" }}>
      <td style={{ padding: "10px 12px" }}>{sub.email}</td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{sub.productId}</td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{sub.variantId}</td>
      <td style={{ padding: "10px 12px" }}>
        <StatusBadge status={sub.status} />
      </td>
      <td style={{ padding: "10px 12px" }}>
        {new Date(sub.subscribedAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const {
    stats,
    subscribers,
    total,
    statusFilter,
    sort,
    page,
    pageSize,
    autoSendEnabled,
    plan,
    planLimit,
    emailsRemaining,
    planLimitReached,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function buildUrl(params: Record<string, string>) {
    const base = new URLSearchParams({
      status: statusFilter,
      sort,
      page: String(page),
    });
    for (const [k, v] of Object.entries(params)) {
      base.set(k, v);
    }
    return `/app?${base.toString()}`;
  }

  return (
    <s-page heading="Back in Stock — Dashboard">
      <s-stack direction="block" gap="base">

        {/* Auto-send paused banner */}
        {!autoSendEnabled && (
          <s-banner tone="warning">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text>
                Auto-send is paused. Subscribers won&apos;t receive emails when items restock.
              </s-text>
              <Form method="post">
                <input type="hidden" name="intent" value="send_now" />
                <s-button
                  type="submit"
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Send now
                </s-button>
              </Form>
            </div>
          </s-banner>
        )}

        {/* Plan limit reached banner */}
        {planLimitReached && (
          <s-banner tone="critical">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text>
                You&apos;ve reached your {plan} plan limit of {planLimit} emails this month.
              </s-text>
              <s-link href="/app/billing">Upgrade plan</s-link>
            </div>
          </s-banner>
        )}

        {/* Stats row */}
        <s-section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "16px",
            }}
          >
            {[
              { label: "Total Subscribers", value: stats.total },
              { label: "Pending Alerts", value: stats.pending },
              { label: "Emails Sent This Month", value: stats.sentThisMonth },
              { label: `${plan} plan — emails remaining`, value: emailsRemaining },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  border: "1px solid #e4e5e7",
                  borderRadius: "8px",
                  padding: "16px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "28px", fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>{label}</div>
              </div>
            ))}
          </div>
        </s-section>

        {/* Filters and controls */}
        <s-section heading="Subscribers">
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={{ fontSize: "13px", marginBottom: "4px" }}>Filter by status</div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  submit(
                    { status: e.target.value, sort, page: "1" },
                    { method: "get", action: "/app" },
                  );
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "4px",
                  border: "1px solid #c9cccf",
                }}
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="NOTIFIED">Notified</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: "13px", marginBottom: "4px" }}>Sort by date</div>
              <select
                value={sort}
                onChange={(e) => {
                  submit(
                    { status: statusFilter, sort: e.target.value, page: "1" },
                    { method: "get", action: "/app" },
                  );
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "4px",
                  border: "1px solid #c9cccf",
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <a
                href={`/app/subscribers/export?status=${statusFilter}&format=csv`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "1px solid #c9cccf",
                  background: "#fff",
                  color: "#202223",
                  fontSize: "14px",
                  textDecoration: "none",
                  lineHeight: "1.5",
                }}
              >
                Export CSV
              </a>
              <a
                href={`/app/subscribers/export?status=${statusFilter}&format=json`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "1px solid #c9cccf",
                  background: "#fff",
                  color: "#202223",
                  fontSize: "14px",
                  textDecoration: "none",
                  lineHeight: "1.5",
                }}
              >
                Export JSON
              </a>
            </div>
          </div>

          {/* Subscriber table */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "2px solid #e4e5e7",
                    textAlign: "left",
                  }}
                >
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Email</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Product ID</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Variant ID</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>Date Subscribed</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: "24px 12px",
                        textAlign: "center",
                        color: "#6d7175",
                      }}
                    >
                      No subscribers yet. Once shoppers sign up for back-in-stock alerts,
                      they&apos;ll appear here.
                    </td>
                  </tr>
                ) : (
                  subscribers.map((sub) => (
                    <SubscriberRow key={sub.id} sub={sub} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginTop: "16px",
              }}
            >
              <s-text>
                Page {page} of {totalPages} ({total} total)
              </s-text>
              <div style={{ display: "flex", gap: "8px" }}>
                {page > 1 ? (
                  <s-link href={buildUrl({ page: String(page - 1) })}>
                    <s-button variant="tertiary">Previous</s-button>
                  </s-link>
                ) : (
                  <s-button variant="tertiary" disabled>
                    Previous
                  </s-button>
                )}
                {page < totalPages ? (
                  <s-link href={buildUrl({ page: String(page + 1) })}>
                    <s-button variant="tertiary">Next</s-button>
                  </s-link>
                ) : (
                  <s-button variant="tertiary" disabled>
                    Next
                  </s-button>
                )}
              </div>
            </div>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
