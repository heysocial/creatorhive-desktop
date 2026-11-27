import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useMeAccess } from "./access";

/*
  The Job board's Affiliates section (creatorhive-app docs/affiliate-job-board-v2.md,
  servers from Nov 30 2026). No application step: a creator opens a campaign and
  uploads up to 50 videos at once; each goes to CreatorHive's review, then to the
  affiliate's marketplace, where it's bought at the affiliate's own price.
*/

export interface AffiliateCampaign {
  id: string;
  name: string;
  brand: { id: string; name: string; logoUrl: string | null; initial: string };
  imageUrl: string | null;
  priceCents: number;
  wanted: { gender: "female" | "male" | null; ages: string[]; ethnicities: string[]; label: string };
  wantedChips: string[];
  audience: string | null;
  script: string | null;
  briefUrl: string | null;
  postedAt: string | null;
  mine: { total: number; inReview: number; live: number; bought: number; rejected: number; earnedCents: number };
}

export type CampaignVideoStatus = "in_review" | "live" | "bought" | "rejected" | "revision";

export interface CampaignVideo {
  id: string;
  fileName: string;
  sentAt: string;
  status: CampaignVideoStatus;
  rejectReason: string | null;
  revisionNote: string | null;
  earnedCents: number;
  thumbnailUrl: string | null;
}

export interface AffiliateJobs {
  campaigns: AffiliateCampaign[];
  earnings: { totalCents: number; pendingCents: number; paidCents: number; soldCount: number };
  maxBatch: number;
}

export const AFFILIATE_JOBS_KEY = ["jobs", "affiliates"] as const;
export const campaignKey = (id: string) => ["jobs", "affiliates", id] as const;

/** Where the member's Job board stands: hidden, "Coming soon", only the website's Brands (an agency's creator), or the native board. */
export function useJobBoardAccess(): "none" | "soon" | "website" | "native" {
  const data = useMeAccess().data;
  if (!data) return "none";
  if (data.jobBoardLocked) return "soon";
  if (data.affiliateJobs) return "native";
  return data.jobBoard ? "website" : "none";
}

export function useAffiliateJobs(enabled = true) {
  return useQuery({
    queryKey: AFFILIATE_JOBS_KEY,
    enabled,
    queryFn: async () => {
      const data = await api<Partial<AffiliateJobs>>("/api/jobs/affiliates");
      return {
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
        earnings: data.earnings ?? { totalCents: 0, pendingCents: 0, paidCents: 0, soldCount: 0 },
        maxBatch: data.maxBatch ?? 50,
      } satisfies AffiliateJobs;
    },
  });
}

export function useAffiliateCampaign(id: string) {
  return useQuery({
    queryKey: campaignKey(id),
    queryFn: async () => {
      const data = await api<{ campaign: AffiliateCampaign; videos?: CampaignVideo[] }>(`/api/jobs/affiliates/${encodeURIComponent(id)}`);
      return { campaign: data.campaign, videos: Array.isArray(data.videos) ? data.videos : [] };
    },
  });
}

/** An agency's creator: how many brand jobs the website's Brands section has (GET /api/jobs, 404 for anyone else). */
export function useBrandJobCount(enabled: boolean) {
  return useQuery({
    queryKey: ["jobs", "brands", "count"],
    enabled,
    queryFn: async () => (await api<{ jobs?: unknown[] }>("/api/jobs")).jobs?.length ?? 0,
  });
}

/** "$35", "$35.50". */
export function usd(cents: number) {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "4 sent · 1 in review · 2 bought" (only the parts that aren't 0), or null when she has none on it. */
export function mineLine(mine: AffiliateCampaign["mine"] | undefined): string | null {
  if (!mine || !mine.total) return null;
  const parts = [`${mine.total} sent`];
  if (mine.inReview) parts.push(`${mine.inReview} in review`);
  if (mine.live) parts.push(`${mine.live} in the marketplace`);
  if (mine.bought) parts.push(`${mine.bought} bought`);
  if (mine.rejected) parts.push(`${mine.rejected} not accepted`);
  return parts.join(" · ");
}

/** A video's status, in the contract's words, and the Hub stage colours it borrows. */
export function videoStatus(video: CampaignVideo, priceCents: number): { label: string; tone: string } {
  switch (video.status) {
    case "live": return { label: "In the brand's marketplace", tone: "s-delivered" };
    case "bought": return { label: `Bought · +${usd(video.earnedCents || priceCents)}`, tone: "s-completed" };
    case "rejected": return { label: video.rejectReason?.trim() || "Not accepted", tone: "s-case_study" };
    case "revision": return { label: video.revisionNote?.trim() ? `Revision: ${video.revisionNote.trim()}` : "Revision asked", tone: "s-revisions" };
    default: return { label: "In review", tone: "s-pending_payment" };
  }
}

/** What the server takes (MP4/MOV/M4V/WebM, ≤ 2 GB). */
export const CAMPAIGN_VIDEO_EXT = ["mp4", "mov", "m4v", "webm"];
export const CAMPAIGN_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const CAMPAIGN_VIDEO_ACCEPT = ".mp4,.mov,.m4v,.webm,video/mp4,video/quicktime,video/x-m4v,video/webm";
/** At most this many files go up at once. */
export const UPLOAD_PARALLEL = 4;
