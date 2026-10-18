import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "./supabase";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const statusNames = { new: "Pending", in_progress: "Under review", resolved: "Resolved" };
const categoryNames = { INFRASTRUCTURE: "Infrastructure", PUBLIC_SAFETY: "Public safety", ENVIRONMENTAL: "Environmental", HUMAN_SERVICES: "Human services", ANIMAL_CONTROL: "Animal control" };

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("reports");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0];

  async function load() {
    if (!supabaseReady) { setLoading(false); return; }
    const [{ data: ticketRows, error: ticketError }, { data: agencyRows, error: agencyError }] = await Promise.all([
      supabase.from("tickets").select("*").is("duplicate_of", null).order("priority_score", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("agencies").select("*").order("name"),
    ]);
    if (ticketError || agencyError) setError(ticketError?.message || agencyError?.message);
    else {
      setTickets(ticketRows || []); setAgencies(agencyRows || []);
      setSelectedId((current) => current ?? ticketRows?.[0]?.id ?? null);
    }
    setLoading(false);
  }

  async function loadMessages(conversationId) {
    if (!conversationId || !supabaseReady) return;
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at");
    setMessages(data || []);
  }

  useEffect(() => {
    load();
    if (!supabaseReady) return;
    const channel = supabase.channel("agency-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  useEffect(() => { loadMessages(selected?.conversation_id); }, [selected?.conversation_id]);
  useEffect(() => {
    if (!supabaseReady || !selected?.conversation_id) return;
    const channel = supabase.channel(`messages-${selected.conversation_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${selected.conversation_id}` }, () => loadMessages(selected.conversation_id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selected?.conversation_id]);

  const agency = agencies.find((item) => item.id === selected?.agency_id);
  const visible = useMemo(() => tickets.filter((ticket) => {
    const agencyMatch = agencyFilter === "all" || ticket.agency_id === agencyFilter;
    const statusMatch = statusFilter === "all" || (statusFilter === "active" ? ticket.status !== "resolved" && ticket.credibility !== "spam" : statusFilter === "flagged" ? ticket.credibility !== "ok" : ticket.status === statusFilter);
    const text = `${ticket.id} ${ticket.summary} ${ticket.location_text} ${ticket.category}`.toLowerCase();
    return agencyMatch && statusMatch && text.includes(query.toLowerCase());
  }), [tickets, agencyFilter, statusFilter, query]);

  const stats = useMemo(() => ({
    needsReview: tickets.filter((t) => t.status === "new" && t.credibility !== "spam").length,
    critical: tickets.filter((t) => t.priority === "CRITICAL" && t.status !== "resolved").length,
    active: tickets.filter((t) => t.status !== "resolved" && t.credibility !== "spam").length,
    reached: tickets.filter((t) => t.published_at).reduce((sum, t) => sum + (t.report_count || 1), 0),
  }), [tickets]);

  async function patchTicket(body, success) {
    if (!selected) return;
    setError("");
    const response = await fetch(`${API}/api/tickets/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The backend could not update this report."); return; }
    setNotice(success); window.setTimeout(() => setNotice(""), 3500); await load();
  }

  async function sendMessage(event) {
    event.preventDefault(); if (!message.trim() || !selected) return;
    const response = await fetch(`${API}/api/tickets/${selected.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: message }) });
    if (!response.ok) { setError("The message could not be sent."); return; }
    setMessage(""); setNotice("Update sent to the resident by SMS."); await loadMessages(selected.conversation_id);
  }

  if (!supabaseReady) return <Setup />;
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span>C4Y</span><div><strong>Community4You</strong><small>LA County response</small></div></div>
      <nav><button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}>▦ Incident queue</button><button className={view === "organizations" ? "active" : ""} onClick={() => setView("organizations")}>◎ Organizations</button></nav>
      <div className="org-list"><p>ROUTING NETWORK</p><button className={agencyFilter === "all" ? "selected" : ""} onClick={() => { setAgencyFilter("all"); setView("reports"); }}><i className="all"/>All organizations <b>{tickets.filter(t=>t.status!=="resolved").length}</b></button>{agencies.map((org) => <button key={org.id} className={agencyFilter === org.id ? "selected" : ""} onClick={() => { setAgencyFilter(org.id); setView("reports"); }}><i className={org.id}/><span>{org.name}</span><b>{tickets.filter(t=>t.agency_id===org.id&&t.status!=="resolved").length}</b></button>)}</div>
      <div className="live"><span/> Supabase realtime connected</div>
    </aside>
    <main>
      <header className="topbar"><div><p>AGENCY OPERATIONS CENTER</p><h1>{view === "organizations" ? "Organization network" : "Incident command"}</h1></div><div className="top-actions"><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search reports…"/><span className="avatar">MM</span></div></header>
      {error && <div className="error">{error}</div>}{notice && <div className="notice">✓ {notice}</div>}
      {view === "organizations" ? <Organizations agencies={agencies} tickets={tickets} onOpen={(id)=>{setAgencyFilter(id);setView("reports");}}/> : <>
        <section className="stats"><Stat label="Needs review" value={stats.needsReview} sub={`${stats.critical} critical`} tone="red"/><Stat label="Active incidents" value={stats.active} sub="Live from Supabase" tone="amber"/><Stat label="Organizations online" value={agencies.length} sub="Across LA County" tone="blue"/><Stat label="Reports represented" value={stats.reached} sub="On public alert feed" tone="green"/></section>
        <div className="command-grid">
          <section className="queue card"><div className="section-head"><div><span className="pulse"/>LIVE QUEUE</div><small>{visible.length} reports</small></div><div className="filters">{[["active","Active"],["new","Pending"],["in_progress","Review"],["resolved","Resolved"],["flagged","Flagged"],["all","All"]].map(([key,label])=><button key={key} className={statusFilter===key?"active":""} onClick={()=>setStatusFilter(key)}>{label}</button>)}</div><div className="ticket-list">{loading ? <div className="empty">Loading live reports…</div> : visible.map(ticket=><Ticket key={ticket.id} ticket={ticket} agency={agencies.find(a=>a.id===ticket.agency_id)} active={ticket.id===selected?.id} onClick={()=>setSelectedId(ticket.id)}/>)}{!loading&&!visible.length&&<div className="empty">No reports match these filters.</div>}</div></section>
          <section className="detail card">{selected ? <><div className="detail-top"><div><span className={`priority ${selected.priority.toLowerCase()}`}>{selected.priority}</span>{selected.credibility!=="ok"&&<span className="flag">⚑ {selected.credibility}</span>}</div><span>REPORT #{selected.id}</span></div><h2>{selected.summary}</h2><p className="location">⌖ {selected.location_text || "Location still being clarified"}</p><div className="route"><div className={`agency-mark ${agency?.id}`}>{agency?.name?.slice(0,2).toUpperCase()}</div><div><small>AI ROUTED TO</small><strong>{agency?.name || selected.agency_id}</strong><p>{agency?.description}</p></div><b>{selected.priority_score}/100</b></div><div className="analysis"><div><small>WHY THIS PRIORITY</small><p>{selected.priority_reason}</p></div><div><small>SUGGESTED RESPONSE</small><p>{selected.suggested_action || "Agency review required."}</p></div><div><small>DUPLICATE ANALYSIS</small><p>{selected.report_count > 1 ? `${selected.report_count} community reports matched this incident.` : "No matching report found."}</p></div><div><small>REPORTER</small><p>{maskPhone(selected.phone)}</p></div></div><div className="conversation"><div className="section-head"><div>SMS CONVERSATION</div><small>{messages.length} messages</small></div>{messages.map(item=><div key={item.id} className={`bubble ${item.sender}`}><small>{item.sender}</small>{item.body}</div>)}</div><form className="message-form" onSubmit={sendMessage}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Text an update to the resident…"/><button>Send SMS</button></form><div className="actions"><button className="review" onClick={()=>patchTicket({status:"in_progress"},"Report moved to agency review; the resident was notified.")}>Begin review</button><button className="resolve" onClick={()=>patchTicket({status:"resolved"},"Report resolved; the resident was notified.")}>Resolve</button><button className="publish" onClick={()=>patchTicket({published:!selected.published_at},selected.published_at?"Removed from the public site.":"Published on the public alert website.")}>{selected.published_at ? "Unpublish alert" : "Publish public alert"}</button></div></> : <div className="empty">Select a report.</div>}</section>
        </div>
      </>}
    </main>
  </div>;
}

function Ticket({ticket,agency,active,onClick}) { return <button className={`ticket ${active?"active":""}`} onClick={onClick}><div><span className={`dot ${ticket.priority.toLowerCase()}`}/><strong>#{ticket.id} · {categoryNames[ticket.category]}</strong><time>{relative(ticket.created_at)}</time></div><h3>{ticket.subcategory}</h3><p>{ticket.summary}</p><footer><span>{agency?.name || ticket.agency_id}</span><b>{statusNames[ticket.status]}</b>{ticket.report_count>1&&<em>+{ticket.report_count-1} similar</em>}</footer></button> }
function Stat({label,value,sub,tone}) { return <article className="stat"><i className={tone}/><div><p>{label}</p><strong>{value}</strong><small>{sub}</small></div></article> }
function Organizations({agencies,tickets,onOpen}) { return <section className="network"><div className="network-hero"><p>AI ROUTING DIRECTORY</p><h2>Every report reaches the team built to solve it.</h2><span>The backend classifies each SMS, scores urgency, checks credibility, and stores its agency match in Supabase.</span></div><div className="org-cards">{agencies.map(org=>{const active=tickets.filter(t=>t.agency_id===org.id&&t.status!=="resolved").length;return <article key={org.id}><div className={`agency-mark ${org.id}`}>{org.name.slice(0,2).toUpperCase()}</div><small>{org.categories?.map(c=>categoryNames[c]).join(", ")}</small><h3>{org.name}</h3><p>{org.description}</p><footer><strong>{active}</strong><span>active reports</span><button onClick={()=>onOpen(org.id)}>Open queue →</button></footer></article>})}</div></section> }
function Setup() { return <main className="setup"><span>C4Y</span><h1>Connect the agency dashboard</h1><p>Create <code>agency-dashboard/.env.local</code> and add the two browser-safe Supabase values from your project settings.</p><pre>VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co{"\n"}VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY{"\n"}VITE_API_URL=http://localhost:3000</pre><p>Restart <code>npm run dev</code> after saving it. Never place the Supabase secret key here.</p></main> }
function maskPhone(phone="") { if(phone.startsWith("web:")) return "Web reporter"; return phone.length>=4 ? `(•••) •••-${phone.slice(-4)}` : "Anonymous"; }
function relative(value) { const minutes=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000)); return minutes<1?"now":minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h`:`${Math.floor(minutes/1440)}d`; }
