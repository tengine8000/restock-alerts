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
  reconcileShopPlan,
} from "../services/notification.server";

const PRODUCT_IMAGES_QUERY = `#graphql
  query ProductImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredImage {
          url(transform: { maxWidth: 200, maxHeight: 200 })
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

  const [stats, { subscribers, total }, settings, allProductGroups, { plan: reconciledPlan }] = await Promise.all([
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
    reconcileShopPlan(shop, admin.graphql.bind(admin)),
  ]);

  const gridSourceGroups =
    gridFilter === "all"
      ? allProductGroups
      : allProductGroups.filter((g) => g.pending > 0);

  const gridTotal = gridSourceGroups.length;
  const gridTotalPages = Math.max(1, Math.ceil(gridTotal / GRID_PAGE_SIZE));
  const safeGridPage = Math.min(gridPage, gridTotalPages);
  const pagedGroups = gridSourceGroups.slice(
    (safeGridPage - 1) * GRID_PAGE_SIZE,
    safeGridPage * GRID_PAGE_SIZE,
  );

  // Always fetch images regardless of view — warms browser cache so grid feels instant
  const imageMap: Record<string, string> = {};
  if (pagedGroups.length > 0) {
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
  const planLimit = PLAN_LIMITS[reconciledPlan] ?? PLAN_LIMITS["FREE"];
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
    productGroups: allProductGroups,
    pagedProductGroups,
    autoSendEnabled: resolvedSettings.autoSendEnabled,
    plan: reconciledPlan,
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
    await reconcileShopPlan(shop, admin.graphql.bind(admin));

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

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function avatarColor(email: string): string {
  const palette = ["#4f86c6", "#26a06b", "#e8853a", "#9c6acb", "#e55f5f", "#3db5b5", "#d4a017"];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const statusStyle: Record<string, React.CSSProperties> = {
  PENDING: {
    background: "#fff3cd",
    color: "#7a4800",
    border: "1px solid #ffc453",
    padding: "3px 10px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
  },
  NOTIFIED: {
    background: "#e6f4ea",
    color: "#1a5c2a",
    border: "1px solid #8bc98b",
    padding: "3px 10px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
  },
  UNSUBSCRIBED: {
    background: "#f1f2f3",
    color: "#6d7175",
    border: "1px solid #c9cccf",
    padding: "3px 10px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
  },
};

const statusDot: Record<string, string> = {
  PENDING: "#f59e0b",
  NOTIFIED: "#22c55e",
  UNSUBSCRIBED: "#9ca3af",
};

function StatusBadge({ status }: { status: string }) {
  const key = status in statusStyle ? status : "PENDING";
  return (
    <span style={statusStyle[key]}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: statusDot[key] ?? "#9ca3af", display: "inline-block", flexShrink: 0 }} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ─── Email avatar ─────────────────────────────────────────────────────────────

function EmailAvatar({ email }: { email: string }) {
  return (
    <div style={{
      width: "30px", height: "30px", borderRadius: "50%",
      background: avatarColor(email), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "12px", fontWeight: 700, flexShrink: 0,
      textTransform: "uppercase",
    }}>
      {email[0]}
    </div>
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────

function SubscriberRow({ sub }: { sub: Subscriber }) {
  const productLabel = sub.productTitle ?? `Product #${sub.productId}`;
  const variantLabel = sub.variantTitle && sub.variantTitle !== "Default Title" ? sub.variantTitle : null;
  return (
    <tr style={{ borderBottom: "1px solid #f1f2f3" }}>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <EmailAvatar email={sub.email} />
          <span style={{ fontSize: "14px", color: "#202223" }}>{sub.email}</span>
        </div>
      </td>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: "14px", color: "#202223" }}>{productLabel}</div>
        {variantLabel && <div style={{ fontSize: "12px", color: "#8c9196", marginTop: "2px" }}>{variantLabel}</div>}
      </td>
      <td style={{ padding: "12px 16px" }}><StatusBadge status={sub.status} /></td>
      <td style={{ padding: "12px 16px", fontSize: "14px", color: "#6d7175" }}>
        {new Date(sub.subscribedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })}
      </td>
      <td style={{ padding: "12px 16px", textAlign: "center" }}>
        <span style={{ fontSize: "18px", color: "#8c9196", cursor: "pointer", letterSpacing: "1px", userSelect: "none" }}>···</span>
      </td>
    </tr>
  );
}

// ─── Product card ─────────────────────────────────────────────────────────────

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
        borderRadius: "10px",
        overflow: "hidden",
        cursor: "pointer",
        background: "#fff",
        transition: "box-shadow 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        (e.currentTarget as HTMLDivElement).style.transform = "none";
      }}
    >
      {/* Image area */}
      <div style={{ position: "relative", height: "160px", background: "#f6f6f7" }}>
        {group.imageUrl ? (
          <>
            {imgLoading && (
              <div className="img-shimmer" style={{ position: "absolute", inset: 0 }} />
            )}
            <img
              src={group.imageUrl}
              alt={group.productTitle}
              onLoad={() => setImgLoading(false)}
              onError={() => setImgLoading(false)}
              style={{
                width: "100%", height: "100%", objectFit: "cover",
                opacity: imgLoading ? 0 : 1,
                transition: "opacity 0.25s",
              }}
            />
          </>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f6f7" }}>
            <span style={{ fontSize: "36px", fontWeight: 700, color: "#c9cccf" }}>{initials}</span>
          </div>
        )}

        {/* Pending badge */}
        {group.pending > 0 && (
          <div style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "#ffc453",
            color: "#3d2400",
            fontSize: "12px",
            fontWeight: 700,
            padding: "3px 9px",
            borderRadius: "20px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            gap: "3px",
          }}>
            <span style={{ fontSize: "10px" }}>↑</span>
            {formatCount(group.pending)} waiting
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "6px", lineHeight: 1.4, color: "#202223" }}>
          {group.productTitle}
        </div>
        <div style={{ display: "flex", gap: "14px", fontSize: "12px", color: "#8c9196" }}>
          <span><strong style={{ color: "#6d7175" }}>{formatCount(group.total)}</strong> total</span>
          <span><strong style={{ color: "#6d7175" }}>{formatCount(group.pending)}</strong> pending</span>
          <span><strong style={{ color: "#6d7175" }}>{formatCount(group.total - group.pending)}</strong> notified</span>
        </div>
      </div>
    </div>
  );
}

// ─── View toggle icons ────────────────────────────────────────────────────────

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="2" rx="1" fill={active ? "#202223" : "#8c9196"} />
      <rect x="1" y="7" width="14" height="2" rx="1" fill={active ? "#202223" : "#8c9196"} />
      <rect x="1" y="11" width="14" height="2" rx="1" fill={active ? "#202223" : "#8c9196"} />
    </svg>
  );
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1" fill={active ? "#202223" : "#8c9196"} />
      <rect x="9" y="1" width="6" height="6" rx="1" fill={active ? "#202223" : "#8c9196"} />
      <rect x="1" y="9" width="6" height="6" rx="1" fill={active ? "#202223" : "#8c9196"} />
      <rect x="9" y="9" width="6" height="6" rx="1" fill={active ? "#202223" : "#8c9196"} />
    </svg>
  );
}

// ─── Shared select style ──────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid #c9cccf",
  fontSize: "14px",
  color: "#202223",
  background: "#fff",
  cursor: "pointer",
  outline: "none",
};

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
    [statusFilter, productFilter],
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
    for (const [k, v] of Object.entries(params)) base.set(k, v);
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

  const statCards = [
    {
      label: "Total Subscribers",
      value: formatCount(stats.total),
      subtitle: "All time",
      dot: "#8c9196",
    },
    {
      label: "Pending Alerts",
      value: formatCount(stats.pending),
      subtitle: "Awaiting restock",
      dot: "#f59e0b",
    },
    {
      label: "Emails Sent This Month",
      value: formatCount(stats.sentThisMonth),
      subtitle: "This month",
      dot: "#3b82f6",
    },
    {
      label: plan === "FREE" ? "Free Plan" : `${plan.charAt(0) + plan.slice(1).toLowerCase()} Plan`,
      value: formatCount(emailsRemaining),
      subtitle: "emails remaining",
      dot: "#3b82f6",
    },
  ];

  return (
    <s-page heading="Restock Alerts — Dashboard">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shimmer {
          0% { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        .img-shimmer {
          background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
          background-size: 600px 100%;
          animation: shimmer 1.4s ease-in-out infinite;
        }
        select:focus { box-shadow: 0 0 0 2px #458fff40; border-color: #458fff; }
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

        {/* ── Send notifications action bar ── */}
        {stats.pending > 0 && !planLimitReached && (
          <div style={{
            background: "#fff",
            border: "1px solid #e4e5e7",
            borderRadius: "10px",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#202223" }}>
                {formatCount(stats.pending)} subscriber{stats.pending !== 1 ? "s" : ""} waiting for restock notifications
              </span>
              <span style={{ fontSize: "13px", color: "#6d7175", marginLeft: "8px" }}>
                · {autoSendEnabled ? "Auto-send is on" : "Auto-send is paused"}
              </span>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="send_now" />
              <s-button variant="primary" type="submit" {...(isSubmitting ? { loading: true } : {})}>
                Send notifications now
              </s-button>
            </Form>
          </div>
        )}

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {statCards.map(({ label, value, subtitle, dot }) => (
            <div key={label} style={{
              background: "#fff",
              border: "1px solid #e4e5e7",
              borderRadius: "10px",
              padding: "16px 20px 14px",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", top: "14px", right: "14px",
                width: "8px", height: "8px", borderRadius: "50%",
                background: dot,
              }} />
              <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "6px", paddingRight: "20px" }}>{label}</div>
              <div style={{ fontSize: "30px", fontWeight: 700, lineHeight: 1, color: "#202223", marginBottom: "6px" }}>{value}</div>
              <div style={{ fontSize: "12px", color: "#8c9196" }}>{subtitle}</div>
            </div>
          ))}
        </div>

        {/* ── Subscribers section ── */}
        <div style={{ background: "#fff", border: "1px solid #e4e5e7", borderRadius: "10px", padding: "20px 24px" }}>

          {/* Section header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "4px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#202223" }}>Subscribers</div>
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "3px" }}>
                People waiting to be notified when products are back in stock.
              </div>
            </div>

            {/* View toggle */}
            <div style={{ display: "flex", border: "1px solid #e4e5e7", borderRadius: "6px", overflow: "hidden", marginTop: "2px" }}>
              <button
                onClick={() => navigate({ view: "list", page: "1", gridPage: "1" })}
                title="List view"
                style={{
                  padding: "7px 10px",
                  border: "none",
                  borderRight: "1px solid #e4e5e7",
                  background: view === "list" ? "#f1f2f3" : "#fff",
                  cursor: "pointer",
                  display: "flex", alignItems: "center",
                }}
              >
                <ListIcon active={view === "list"} />
              </button>
              <button
                onClick={() => navigate({ view: "grid", page: "1", gridPage: "1" })}
                title="Grid view"
                style={{
                  padding: "7px 10px",
                  border: "none",
                  background: view === "grid" ? "#f1f2f3" : "#fff",
                  cursor: "pointer",
                  display: "flex", alignItems: "center",
                }}
              >
                <GridIcon active={view === "grid"} />
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "#f1f2f3", margin: "14px 0" }} />

          {/* Controls row */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>

            {/* Status filter — both views */}
            <div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", fontWeight: 500 }}>Status</div>
              <select
                value={statusFilter}
                onChange={(e) => navigate({ status: e.target.value, page: "1", gridPage: "1" })}
                style={selectStyle}
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="NOTIFIED">Notified</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
              </select>
            </div>

            {/* List-only controls */}
            {view === "list" && productGroups.length > 0 && (
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", fontWeight: 500 }}>Product</div>
                <select
                  value={productFilter}
                  onChange={(e) => navigate({ product: e.target.value, page: "1" })}
                  style={{ ...selectStyle, maxWidth: "220px" }}
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

            {view === "list" && (
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", fontWeight: 500 }}>Sort by date</div>
                <select
                  value={sort}
                  onChange={(e) => navigate({ sort: e.target.value, page: "1" })}
                  style={selectStyle}
                >
                  <option value="subscribedAt_desc">Newest first</option>
                  <option value="subscribedAt_asc">Oldest first</option>
                </select>
              </div>
            )}

            {view === "list" && (
              <div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", fontWeight: 500 }}>Per page</div>
                <select
                  value={listPageSize}
                  onChange={(e) => navigate({ pageSize: e.target.value, page: "1" })}
                  style={selectStyle}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Export buttons — list only */}
            {view === "list" && (
              <div style={{ display: "flex", gap: "8px" }}>
                {(["csv", "json"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    disabled={isExporting !== null}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid #c9cccf",
                      background: "#fff",
                      color: "#202223",
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor: isExporting ? "wait" : "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isExporting) (e.currentTarget as HTMLButtonElement).style.background = "#f6f6f7"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fff"; }}
                  >
                    {isExporting === fmt ? "Exporting…" : `Export ${fmt.toUpperCase()}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content area with navigation overlay */}
          <div style={{ position: "relative" }}>
            {isNavigating && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10,
                background: "rgba(255,255,255,0.75)",
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "8px",
                animation: "fadeIn 0.2s ease 0.15s both",
              }}>
                <div style={{
                  width: "32px", height: "32px",
                  border: "3px solid #e4e5e7",
                  borderTopColor: "#458fff",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                }} />
              </div>
            )}

            {/* ── Grid view ── */}
            {view === "grid" && (
              gridTotal === 0 ? (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "#6d7175" }}>
                  {gridFilter === "pending" ? (
                    <>
                      No products with pending alerts.{" "}
                      <button
                        onClick={() => navigate({ gridFilter: "all", gridPage: "1" })}
                        style={{ background: "none", border: "none", color: "#458fff", cursor: "pointer", padding: 0, fontSize: "14px", textDecoration: "underline" }}
                      >
                        Show all products
                      </button>
                    </>
                  ) : (
                    "No subscribers yet. Product cards will appear here once shoppers sign up for restock alerts."
                  )}
                </div>
              ) : (
                <>
                  {/* Grid header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <span style={{ fontSize: "13px", color: "#6d7175", fontWeight: 500 }}>
                      {gridFilter === "pending"
                        ? `${gridTotal} product${gridTotal === 1 ? "" : "s"} waiting for restock`
                        : `${gridTotal} product${gridTotal === 1 ? "" : "s"} total`}
                    </span>
                    <button
                      onClick={() => navigate({ gridFilter: gridFilter === "pending" ? "all" : "pending", gridPage: "1" })}
                      style={{ background: "none", border: "none", color: "#458fff", cursor: "pointer", fontSize: "13px", padding: 0, fontWeight: 500 }}
                    >
                      {gridFilter === "pending" ? "Show all products →" : "Show pending only →"}
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "14px" }}>
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "20px", paddingTop: "14px", borderTop: "1px solid #f1f2f3" }}>
                      <span style={{ fontSize: "13px", color: "#6d7175" }}>
                        Page {gridPage} of {gridTotalPages} — {gridTotal} products
                      </span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <PaginationButton disabled={gridPage <= 1} href={buildUrl({ gridPage: String(gridPage - 1) })}>Previous</PaginationButton>
                        <PaginationButton disabled={gridPage >= gridTotalPages} href={buildUrl({ gridPage: String(gridPage + 1) })}>Next</PaginationButton>
                      </div>
                    </div>
                  )}
                </>
              )
            )}

            {/* Hidden preloads — forces browser to download grid images while in list view */}
            {view === "list" && pagedProductGroups.map((g) =>
              g.imageUrl ? <img key={g.productId} src={g.imageUrl} alt="" aria-hidden="true" style={{ display: "none" }} /> : null
            )}

            {/* ── List view ── */}
            {view === "list" && (
              <>
                <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid #e4e5e7" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e4e5e7" }}>
                        <th style={{ padding: "10px 16px", fontWeight: 600, color: "#6d7175", fontSize: "12px", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.04em" }}>Email</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600, color: "#6d7175", fontSize: "12px", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.04em" }}>Product</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600, color: "#6d7175", fontSize: "12px", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600, color: "#6d7175", fontSize: "12px", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.04em" }}>Date Subscribed</th>
                        <th style={{ padding: "10px 16px", width: "48px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: "40px 16px", textAlign: "center", color: "#8c9196", fontSize: "14px" }}>
                            No subscribers yet. Once shoppers sign up for restock alerts, they&apos;ll appear here.
                          </td>
                        </tr>
                      ) : (
                        subscribers.map((sub) => <SubscriberRow key={sub.id} sub={sub} />)
                      )}
                    </tbody>
                  </table>
                </div>

                {/* List pagination */}
                {total > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "16px" }}>
                    <span style={{ fontSize: "13px", color: "#6d7175" }}>
                      Page {page} of {listTotalPages} — {total} subscriber{total !== 1 ? "s" : ""}
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <PaginationButton disabled={page <= 1} href={buildUrl({ page: String(page - 1) })}>Previous</PaginationButton>
                      <PaginationButton disabled={page >= listTotalPages} href={buildUrl({ page: String(page + 1) })}>Next</PaginationButton>
                    </div>
                  </div>
                )}
              </>
            )}

          </div>{/* end overlay wrapper */}
        </div>{/* end subscribers section */}

      </s-stack>
    </s-page>
  );
}

// ─── Pagination button ────────────────────────────────────────────────────────

function PaginationButton({ children, disabled, href }: { children: React.ReactNode; disabled: boolean; href: string }) {
  return disabled ? (
    <button
      disabled
      style={{
        padding: "6px 14px", borderRadius: "6px",
        border: "1px solid #e4e5e7", background: "#f9fafb",
        color: "#c9cccf", fontSize: "13px", fontWeight: 500, cursor: "not-allowed",
      }}
    >
      {children}
    </button>
  ) : (
    <a
      href={href}
      style={{
        padding: "6px 14px", borderRadius: "6px",
        border: "1px solid #c9cccf", background: "#fff",
        color: "#202223", fontSize: "13px", fontWeight: 500,
        cursor: "pointer", textDecoration: "none", display: "inline-block",
        transition: "background 0.15s",
      }}
    >
      {children}
    </a>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
