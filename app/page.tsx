import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Alert = {
  id: number; category: string; summary: string; location_text: string | null;
  priority: string; priority_reason: string; status: string; report_count: number;
  published_at: string;
};

async function publicAlerts(): Promise<Alert[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return [];
  const { data, error } = await createClient(url, key, { auth: { persistSession: false } })
    .from("tickets")
    .select("id,category,summary,location_text,priority,priority_reason,status,report_count,published_at")
    .not("published_at", "is", null)
    .neq("credibility", "spam")
    .order("published_at", { ascending: false });
  if (error) { console.error("[public alerts]", error); return []; }
  return data as Alert[];
}

export default async function Home() {
  const alerts = await publicAlerts();
  return <main>
    <header className="public-nav"><a href="/" className="public-brand"><b>C4Y</b><span>Community4You<small>Los Angeles County</small></span></a><nav><a href="#alerts">Live alerts</a><a href="#how">How it works</a><a className="agency-link" href={process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:5173"}>Agency portal ↗</a></nav></header>
    <section className="hero-public"><div><p className="kicker"><i/> COMMUNITY-VERIFIED INFORMATION</p><h1>Know what’s happening.<br/><em>Help your neighborhood.</em></h1><p>Report local hazards by text. Community4You uses AI to organize the details, route them to the right response team, and publish verified updates here.</p><div className="hero-actions"><a href="#alerts">View active alerts</a><span>For emergencies, always call <b>911</b>.</span></div></div><div className="phone-demo"><div className="phone-head"><span>C4Y</span><div><b>Community4You</b><small>Text message</small></div></div><div className="incoming">There is a large pothole at Figueroa and Jefferson. Cars are swerving.</div><div className="outgoing">Thanks! Report #101 was routed to LA Streets &amp; 311. We’ll text you updates.</div><div className="phone-status"><i/> AI triage complete · agency notified</div></div></section>
    <section className="trust-strip"><div><strong>{alerts.length}</strong><span>public alerts</span></div><div><strong>{alerts.reduce((n,a)=>n+a.report_count,0)}</strong><span>community reports represented</span></div><div><strong>5</strong><span>response organizations</span></div><div><strong>24/7</strong><span>SMS reporting</span></div></section>
    <section className="alerts" id="alerts"><div className="public-heading"><div><p className="kicker">LIVE PUBLIC FEED</p><h2>Verified community alerts</h2></div><span><i/> Updated live from the agency portal</span></div>{alerts.length ? <div className="alert-grid">{alerts.map(alert=><article key={alert.id}><header><span className={`public-priority ${alert.priority.toLowerCase()}`}>{alert.priority}</span><small>ALERT #{alert.id}</small></header><p className="category">{alert.category.replace("_"," ")}</p><h3>{alert.summary}</h3><p className="alert-location">⌖ {alert.location_text || "Los Angeles County"}</p><footer><span>{alert.status === "resolved" ? "Resolved" : "Response active"}</span><span>{alert.report_count} {alert.report_count===1?"report":"matching reports"}</span></footer></article>)}</div> : <div className="no-alerts"><h3>No public alerts yet</h3><p>Agency staff publish verified reports from the separate Agency Portal. Configure Supabase and publish a report to see it here.</p></div>}</section>
    <section className="how" id="how"><p className="kicker">FROM TEXT TO ACTION</p><h2>One message. The right response.</h2><div><article><b>01</b><h3>Text what you see</h3><p>No app or account required. Describe the issue and its location.</p></article><article><b>02</b><h3>AI structures the tip</h3><p>Gemini classifies urgency, credibility, duplicates, and the best agency.</p></article><article><b>03</b><h3>An agency responds</h3><p>Staff review the report, text the resident, and publish safe public updates.</p></article></div></section>
    <footer className="public-footer"><div className="public-brand"><b>C4Y</b><span>Community4You<small>One community. One response network.</small></span></div><p>Personal information and reporter phone numbers are never shown publicly.</p></footer>
  </main>;
}
