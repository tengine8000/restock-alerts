import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit, Form, useNavigation } from "react-router";
import { useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getSubscriberStats,
  findAllSubscribers,
  getProductGroups,
  type Subscriber,
  type ProductGroup,
} from "../services/subscriber.server";
import {
  getShopSettings,
  DEFAULT_SETTINGS,
  PLAN_LIMITS,
  NotificationService,
  PlanLimitError,
} from "../services/notification.server";

const PRODUCT_IMAGES_QUERY = `#graphql
  query ProductImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredImage {
          url(transform: { maxWidth: 300, maxHeight: 300 })
          altText
        }
      }
    }
  }
`;

const GRID_PAGE_SIZE = 24;
const VALID_LIST_PAGE_SIZES = [25, 50, 100];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const productFilter = url.searchParams.get("product") ?? "";
  const sortParam = url.searchParams.get("sort") ?? "";
  const viewParam = url.searchParams.get("view");
  const view = viewParam === "list" ? "list" : "grid";
  const sort: "subscribedAt_asc" | "subscribedAt_desc" =
    sortParam === "subscribedAt_asc" ? "subscribedAt_asc" : "subscribedAt_desc";

  const rawListPageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10);
  const listPageSize = VALID_LIST_PAGE_SIZES.includes(rawListPageSize) ? rawListPageSize : 50;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const gridPage = Math.max(1, parseInt(url.searchParams.get("gridPage") ?? "1", 10));
  const gridFilter = url.searchParams.get("gridFilter") === "all" ? "all" : "pending";

  const [stats, { subscribers, total }, settings, allProductGroups] = await Promise.all([
    getSubscriberStats(shop),
    findAllSubscribers({
      shop,
      status: statusFilter || undefined,
      productId: productFilter || undefined,
      sort,
      page,
      pageSize: listPageSize,
    }),
    getShopSettings(shop),
    getProductGroups(shop),
  ]);

  // For grid: filter to pending-only by default so merchants see what needs attention
  const gridSourceGroups =
    gridFilter === "all"
      ? allProductGroups
      : allProductGroups.filter((g) => g.pending > 0);

  // Paginate the filtered set
  const gridTotal = gridSourceGroups.length;
  const gridTotalPages = Math.max(1, Math.ceil(gridTotal / GRID_PAGE_SIZE));
  const safeGridPage = Math.min(gridPage, gridTotalPages);
  const pagedGroups = gridSourceGroups.slice(
    (safeGridPage - 1) * GRID_PAGE_SIZE,
    safeGridPage * GRID_PAGE_SIZE,
  );

  // Fetch images only for the current grid page; chunk for Shopify's 250-ID limit
  const imageMap: Record<string, string> = {};
  if (view === "grid" && pagedGroups.length > 0) {
    const chunks = chunkArray(
      pagedGroups.map((g) => `gid://shopify/Product/${g.productId}`),
      250,
    );
    for (const chunk of chunks) {
      try {
        const res = await admin.graphql(PRODUCT_IMAGES_QUERY, { variables: { ids: chunk } });
        const json = await res.json();
        for (const node of (json?.data?.nodes ?? [])) {
          if (node?.id && node?.featuredImage?.url) {
            const numericId = (node.id as string).split("/").pop()!;
            imageMap[numericId] = node.featuredImage.url as string;
          }
        }
      } catch {
        // non-critical — cards render with initials placeholder
      }
    }
  }

  const pagedProductGroups = pagedGroups.map((g) => ({
    ...g,
    imageUrl: imageMap[g.productId] ?? null,
  }));

  const resolvedSettings = settings ?? DEFAULT_SETTINGS;
  const planLimit = PLAN_LIMITS[resolvedSettings.plan] ?? PLAN_LIMITS["FREE"];
  const emailsRemaining = Math.max(0, planLimit - stats.sentThisMonth);
  const planLimitReached = stats.sentThisMonth >= planLimit;

  return {
    stats,
    subscribers,
    total,
    statusFilter,
    productFilter,
    sort,
    view,
    page,
    listPageSize,
    gridPage: safeGridPage,
    gridTotalPages,
    gridTotal,
    gridFilter,
    // full list (all statuses) — used for the product filter dropdown in list view
    productGroups: allProductGroups,
    // current page only (with images) — used for grid cards
    pagedProductGroups,
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

// ─── Shared styles ────────────────────────────────────────────────────────────

const statusStyle: Record<string, React.CSSProperties> = {
  PENDING: { backgroundColor: "#ffc453", color: "#3d2400", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600, display: "inline-block" },
  NOTIFIED: { backgroundColor: "#b5e3b5", color: "#1a3c1a", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600, display: "inline-block" },
  UNSUBSCRIBED: { backgroundColor: "#e4e5e7", color: "#6d7175", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600, display: "inline-block" },
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={statusStyle[status] ?? statusStyle["PENDING"]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────

function SubscriberRow({ sub }: { sub: Subscriber }) {
  const productLabel = sub.productTitle ?? `Product #${sub.productId}`;
  const variantLabel = sub.variantTitle && sub.variantTitle !== "Default Title" ? sub.variantTitle : null;
  return (
    <tr style={{ borderBottom: "1px solid #e4e5e7" }}>
      <td style={{ padding: "10px 12px" }}>{sub.email}</td>
      <td style={{ padding: "10px 12px" }}>
        <div>{productLabel}</div>
        {variantLabel && <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>{variantLabel}</div>}
      </td>
      <td style={{ padding: "10px 12px" }}><StatusBadge status={sub.status} /></td>
      <td style={{ padding: "10px 12px" }}>{new Date(sub.subscribedAt).toLocaleDateString()}</td>
    </tr>
  );
}

// ─── Grid view ────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ProductCard({
  group,
  onClick,
}: {
  group: ProductGroup & { imageUrl: string | null };
  onClick: () => void;
}) {
  const [imgLoading, setImgLoading] = useState(!!group.imageUrl);

  const initials = group.productTitle
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-label={`View subscribers for ${group.productTitle}`}
      style={{
        border: "1px solid #e4e5e7",
        borderRadius: "8px",
        overflow: "hidden",
        cursor: "pointer",
        background: "#fff",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = "none")}
    >
      {/* Image area */}
      <div style={{ position: "relative", height: "160px", background: "#f6f6f7" }}>
        {group.imageUrl ? (
          <>
            {imgLoading && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#f6f6f7",
              }}>
                <div style={{
                  width: "28px", height: "28px",
                  border: "3px solid #e4e5e7",
                  borderTopColor: "#8c9196",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                }} />
              </div>
            )}
            <img
              src={group.imageUrl}
              alt={group.productTitle}
              onLoad={() => setImgLoading(false)}
              onError={() => setImgLoading(false)}
              style={{
                width: "100%", height: "100%", objectFit: "cover",
                opacity: imgLoading ? 0 : 1,
                transition: "opacity 0.2s",
              }}
            />
          </>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "32px", fontWeight: 700, color: "#babec3" }}>{initials}</span>
          </div>
        )}

        {/* Pending count badge overlay */}
        {group.pending > 0 && (
          <div style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            background: "#ffc453",
            color: "#3d2400",
            fontSize: "12px",
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}>
            {formatCount(group.pending)} waiting
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: "12px" }}>
        <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "6px", lineHeight: 1.3 }}>
          {group.productTitle}
        </div>
        <div style={{ display: "flex", gap: "12px", fontSize: "13px", color: "#6d7175" }}>
          <span>{formatCount(group.total)} total</span>
          <span>{formatCount(group.pending)} pending</span>
          <span>{formatCount(group.total - group.pending)} notified</span>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    stats,
    subscribers,
    total,
    statusFilter,
    productFilter,
    sort,
    view,
    page,
    listPageSize,
    gridPage,
    gridTotalPages,
    gridTotal,
    gridFilter,
    productGroups,
    pagedProductGroups,
    autoSendEnabled,
    plan,
    planLimit,
    emailsRemaining,
    planLimitReached,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isNavigating = navigation.state === "loading";
  const [isExporting, setIsExporting] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      setIsExporting(format);
      try {
        const params = new URLSearchParams({ status: statusFilter, format });
        if (productFilter) params.set("productId", productFilter);
        const res = await fetch(`/app/subscribers/export?${params}`);
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `subscribers.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // silent
      } finally {
        setIsExporting(null);
      }
    },
    [statusFilter, productFilter]
  );

  const listTotalPages = Math.max(1, Math.ceil(total / listPageSize));

  function buildUrl(params: Record<string, string>) {
    const base = new URLSearchParams({
      status: statusFilter,
      product: productFilter,
      sort,
      view,
      page: String(page),
      pageSize: String(listPageSize),
      gridPage: String(gridPage),
      gridFilter,
    });
    for (const [k, v] of Object.entries(params)) {
      base.set(k, v);
    }
    if (!base.get("status")) base.delete("status");
    if (!base.get("product")) base.delete("product");
    if (base.get("pageSize") === "50") base.delete("pageSize");
    if (base.get("gridPage") === "1") base.delete("gridPage");
    if (base.get("gridFilter") === "pending") base.delete("gridFilter");
    return `/app?${base.toString()}`;
  }

  function navigate(params: Record<string, string>) {
    submit(
      {
        status: statusFilter,
        product: productFilter,
        sort,
        view,
        page: String(page),
        pageSize: String(listPageSize),
        gridPage: String(gridPage),
        gridFilter,
        ...params,
      },
      { method: "get", action: "/app" },
    );
  }

  return (
    <s-page heading="Restock Alerts — Dashboard">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <s-stack direction="block" gap="base">

        {/* Auto-send paused banner */}
        {!autoSendEnabled && (
          <s-banner tone="warning">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text>Auto-send is paused. Subscribers won&apos;t receive emails when items restock.</s-text>
              <Form method="post">
                <input type="hidden" name="intent" value="send_now" />
                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Send now</s-button>
              </Form>
            </div>
          </s-banner>
        )}

        {/* Plan limit banner */}
        {planLimitReached && (
          <s-banner tone="critical">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <s-text>You&apos;ve reached your {plan} plan limit of {planLimit} emails this month.</s-text>
              <s-link href="/app/billing">Upgrade plan</s-link>
            </div>
          </s-banner>
        )}

        {/* Stats */}
        <s-section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            {[
              { label: "Total Subscribers", value: stats.total },
              { label: "Pending Alerts", value: stats.pending },
              { label: "Emails Sent This Month", value: stats.sentThisMonth },
              { label: `${plan} plan — emails remaining`, value: emailsRemaining },
            ].map(({ label, value }) => (
              <div key={label} style={{ border: "1px solid #e4e5e7", borderRadius: "8px", padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>{label}</div>
              </div>
            ))}
          </div>
        </s-section>

        {/* Subscribers section */}
        <s-section heading="Subscribers">

          {/* Controls row */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>

            {/* Status filter */}
            <div>
              <div style={{ fontSize: "13px", marginBottom: "4px" }}>Status</div>
              <select
                value={statusFilter}
                onChange={(e) => navigate({ status: e.target.value, page: "1", gridPage: "1" })}
                style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #c9cccf" }}
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="NOTIFIED">Notified</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
              </select>
            </div>

            {/* Product filter — only in list view */}
            {view === "list" && productGroups.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", marginBottom: "4px" }}>Product</div>
                <select
                  value={productFilter}
                  onChange={(e) => navigate({ product: e.target.value, page: "1" })}
                  style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #c9cccf", maxWidth: "220px" }}
                >
                  <option value="">All products</option>
                  {productGroups.map((g) => (
                    <option key={g.productId} value={g.productId}>
                      {g.productTitle}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort — only in list view */}
            {view === "list" && (
              <div>
                <div style={{ fontSize: "13px", marginBottom: "4px" }}>Sort by date</div>
                <select
                  value={sort}
                  onChange={(e) => navigate({ sort: e.target.value, page: "1" })}
                  style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #c9cccf" }}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            )}

            {/* Page size — only in list view */}
            {view === "list" && (
              <div>
                <div style={{ fontSize: "13px", marginBottom: "4px" }}>Per page</div>
                <select
                  value={listPageSize}
                  onChange={(e) => navigate({ pageSize: e.target.value, page: "1" })}
                  style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #c9cccf" }}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Export buttons */}
            {view === "list" && (
              <div style={{ display: "flex", gap: "8px" }}>
                {(["csv", "json"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    disabled={isExporting !== null}
                    style={{ padding: "6px 12px", borderRadius: "4px", border: "1px solid #c9cccf", background: "#fff", color: "#202223", fontSize: "14px", cursor: isExporting ? "wait" : "pointer" }}
                  >
                    {isExporting === fmt ? "Exporting…" : `Export ${fmt.toUpperCase()}`}
                  </button>
                ))}
              </div>
            )}

            {/* View toggle */}
            <div style={{ display: "flex", border: "1px solid #c9cccf", borderRadius: "4px", overflow: "hidden" }}>
              {(["list", "grid"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => navigate({ view: v, page: "1", gridPage: "1" })}
                  title={`${v.charAt(0).toUpperCase() + v.slice(1)} view`}
                  style={{
                    padding: "6px 12px",
                    border: "none",
                    borderRight: v === "list" ? "1px solid #c9cccf" : "none",
                    background: view === v ? "#f1f2f3" : "#fff",
                    color: view === v ? "#202223" : "#6d7175",
                    fontSize: "16px",
                    cursor: "pointer",
                    fontWeight: view === v ? 700 : 400,
                  }}
                >
                  {v === "list" ? "≡" : "⊞"}
                </button>
              ))}
            </div>
          </div>

          {/* Content area — overlay while navigating */}
          <div style={{ position: "relative" }}>
            {isNavigating && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10,
                background: "rgba(255,255,255,0.7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "8px",
                animation: "fadeIn 0.2s ease 0.15s both",
              }}>
                <div style={{
                  width: "36px", height: "36px",
                  border: "4px solid #e4e5e7",
                  borderTopColor: "#8c9196",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                }} />
              </div>
            )}

          {/* Grid view */}
          {view === "grid" && (
            gridTotal === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#6d7175" }}>
                {gridFilter === "pending"
                  ? <>No products with pending alerts. <button onClick={() => navigate({ gridFilter: "all", gridPage: "1" })} style={{ background: "none", border: "none", color: "#2c6ecb", cursor: "pointer", padding: 0, fontSize: "14px", textDecoration: "underline" }}>Show all products</button></>
                  : "No subscribers yet. Product cards will appear here once shoppers sign up."
                }
              </div>
            ) : (
              <>
                {/* Pending / All toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <s-text>
                    {gridFilter === "pending"
                      ? `${gridTotal} product${gridTotal === 1 ? "" : "s"} waiting for restock`
                      : `${gridTotal} product${gridTotal === 1 ? "" : "s"} total`
                    }
                  </s-text>
                  <button
                    onClick={() => navigate({ gridFilter: gridFilter === "pending" ? "all" : "pending", gridPage: "1" })}
                    style={{ background: "none", border: "none", color: "#2c6ecb", cursor: "pointer", fontSize: "13px", textDecoration: "underline", padding: 0 }}
                  >
                    {gridFilter === "pending" ? "Show all products" : "Show pending only"}
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
                  {pagedProductGroups.map((g) => (
                    <ProductCard
                      key={g.productId}
                      group={g}
                      onClick={() => navigate({ view: "list", product: g.productId, page: "1" })}
                    />
                  ))}
                </div>

                {/* Grid pagination */}
                {gridTotalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
                    <s-text>Page {gridPage} of {gridTotalPages} ({gridTotal} products)</s-text>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {gridPage > 1 ? (
                        <s-link href={buildUrl({ gridPage: String(gridPage - 1) })}>
                          <s-button variant="tertiary">Previous</s-button>
                        </s-link>
                      ) : (
                        <s-button variant="tertiary" disabled>Previous</s-button>
                      )}
                      {gridPage < gridTotalPages ? (
                        <s-link href={buildUrl({ gridPage: String(gridPage + 1) })}>
                          <s-button variant="tertiary">Next</s-button>
                        </s-link>
                      ) : (
                        <s-button variant="tertiary" disabled>Next</s-button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )
          )}

          {/* List view */}
          {view === "list" && (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e4e5e7", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Email</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Product</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Date Subscribed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: "24px 12px", textAlign: "center", color: "#6d7175" }}>
                          No subscribers yet. Once shoppers sign up for restock alerts, they&apos;ll appear here.
                        </td>
                      </tr>
                    ) : (
                      subscribers.map((sub) => <SubscriberRow key={sub.id} sub={sub} />)
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
                  <s-text>Page {page} of {listTotalPages} ({total} subscribers)</s-text>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {page > 1 ? (
                      <s-link href={buildUrl({ page: String(page - 1) })}>
                        <s-button variant="tertiary">Previous</s-button>
                      </s-link>
                    ) : (
                      <s-button variant="tertiary" disabled>Previous</s-button>
                    )}
                    {page < listTotalPages ? (
                      <s-link href={buildUrl({ page: String(page + 1) })}>
                        <s-button variant="tertiary">Next</s-button>
                      </s-link>
                    ) : (
                      <s-button variant="tertiary" disabled>Next</s-button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          </div>{/* end navigating overlay wrapper */}

        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
