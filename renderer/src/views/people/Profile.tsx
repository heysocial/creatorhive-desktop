import { CalendarDays, Camera, MapPin, MessageCircle, Pencil, Share } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch, type SessionUser } from "../../lib/bridge";
import { api, keys, queryClient, type Conversation } from "../../lib/api";
import { useMembers } from "../../lib/community";
import { money } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import { Badge } from "../messages/MessageRow";
import { usePoints } from "../home/Today";

interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  presence: string;
  bio: string | null;
  location: string | null;
  headline: string | null;
  instagram: string | null;
  badge?: { kind: string; label: string } | null;
  incomeAmountUsd?: number;
  incomeMonthLabel?: string;
}

interface Stats { dealsCompleted: number; lessonsFinished: number; collectedUsd: number | null; leaderboardRank: number | null; leaderboardSize: number | null }

/** Open (or start) a DM with someone, inside Home. */
export async function messagePerson(userId: string) {
  try {
    const { conversation } = await api<{ conversation: Conversation }>("/api/dms", { method: "POST", body: { userId } });
    await queryClient.invalidateQueries({ queryKey: keys.conversations("creatorhive") });
    nav.open({ kind: "dm", id: conversation.id }, nav.get().section === "dms" ? "dms" : "home", "ch");
  } catch {
    window.alert("You can't message this person right now.");
  }
}

export function ProfilePage({ id, user }: { id: string; user: SessionUser }) {
  const profile = useQuery({ queryKey: ["profile", id], queryFn: async () => (await api<{ profile: Profile }>(`/api/members/${id}/profile`)).profile });
  const stats = useQuery({ queryKey: ["profile-stats", id], queryFn: async () => (await api<{ stats: Stats }>(`/api/members/${id}/stats`)).stats });
  const member = useMembers().data?.find((m) => m.id === id);
  const self = id === user.id;
  const points = usePoints().data;
  const p = profile.data;

  if (profile.isError) return <div className="page"><div className="empty-state">This profile isn't available.</div></div>;

  return (
    <div className="page profile">
      <div className="scroll page-body flush">
        <div className="cover">
          {self ? <button className="btn glassy" onClick={() => ch.app.openSite("/profile")}>Change cover</button> : null}
        </div>
        <div className="profile-cols">
          <div className="profile-main">
            {p ? <Avatar name={p.name} src={p.avatarUrl} seed={p.id} size={128} online={p.presence === "online"} /> : <div className="av-skel" />}
            <h1>{p?.name ?? " "} <Badge badge={p?.badge} /></h1>
            {p?.headline ? <p className="headline">{p.headline}</p> : null}
            <div className="facts">
              {p?.location ? <span><MapPin />{p.location}</span> : null}
              {p?.instagram ? <button onClick={() => ch.app.openExternal(`https://instagram.com/${p.instagram!.replace(/^@/, "")}`)}><Camera />@{p.instagram.replace(/^@/, "")}</button> : null}
              {member?.joinedAt ? <span><CalendarDays />Joined {new Date(member.joinedAt).toLocaleDateString([], { month: "long", year: "numeric" })}</span> : null}
            </div>
            {p?.bio ? <p className="bio selectable">{p.bio}</p> : null}
            <div className="profile-acts">
              {self ? (
                <button className="btn honey" onClick={() => ch.app.openSite("/profile")}><Pencil />Edit profile</button>
              ) : (
                <button className="btn honey" onClick={() => void messagePerson(id)}><MessageCircle />Message</button>
              )}
              <button className="btn" onClick={async () => {
                const { origin } = await ch.info();
                ch.app.share(`${origin}/members?member=${id}`, p ? `${p.name} on CreatorHive` : undefined);
              }}><Share />Share profile</button>
            </div>
            <div className="stat-row">
              {p?.incomeAmountUsd !== undefined ? <div className="card stat"><small>Earned {p.incomeMonthLabel ?? "this month"}</small><b>{money(p.incomeAmountUsd)}</b></div> : null}
              {self && points ? <div className="card stat"><small>Points</small><b>{points.total.toLocaleString()}</b></div> : null}
              {self && points ? <div className="card stat"><small>Streak</small><b>{points.currentStreak === 1 ? "1 day" : `${points.currentStreak} days`}</b></div> : null}
              {stats.data?.leaderboardRank ? <div className="card stat"><small>Leaderboard</small><b>#{stats.data.leaderboardRank}</b></div> : null}
            </div>
          </div>
          <div className="profile-side">
            {stats.data ? (
              <>
                <h3>Progress</h3>
                <div className="kv"><span>Deals completed</span><b>{stats.data.dealsCompleted}</b></div>
                <div className="kv"><span>Lessons finished</span><b>{stats.data.lessonsFinished}</b></div>
                {stats.data.collectedUsd !== null ? <div className="kv"><span>Collected in the Hub</span><b>{money(stats.data.collectedUsd)}</b></div> : null}
                {stats.data.leaderboardRank ? <div className="kv"><span>This month's rank</span><b>{stats.data.leaderboardRank} of {stats.data.leaderboardSize}</b></div> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
