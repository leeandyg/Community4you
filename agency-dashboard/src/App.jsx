import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "./supabase";
import "./App.css";

// Trailing slashes would make "//api/..." URLs, which the backend redirects without CORS headers.
const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const categoryNames = {
  INFRASTRUCTURE: "Infrastructure",
  PUBLIC_SAFETY: "Public safety",
  ENVIRONMENTAL: "Environmental",
  HUMAN_SERVICES: "Human services",
  ANIMAL_CONTROL: "Animal control",
};

async function api(path, method = "GET", body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// Data fetchers: return rows or throw; no React state here.
async function fetchDashboard() {
  const [incidentResult, agencyResult] = await Promise.all([
    supabase
      .from("incidents")
      .select("*, agencies(name, description)")
      .order("priority_score", { ascending: false })
      .order("last_reported_at", { ascending: false }),
    supabase.from("agencies").select("id, name, description, categories").order("name"),
  ]);
  const failure = incidentResult.error || agencyResult.error;
  if (failure) throw new Error(failure.message);
  return { incidents: incidentResult.data || [], agencies: agencyResult.data || [] };
}

function fetchInsights(agencyId) {
  return api(`/api/insights${agencyId && agencyId !== "all" ? `?agency=${agencyId}` : ""}`);
}

async function fetchTickets(incidentId) {
  const { data, error } = await supabase.from("tickets").select("*").eq("incident_id", incidentId).order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchMessages(conversationId) {
  const { data, error } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => readTheme() !== "light");
  const [incidents, setIncidents] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [insights, setInsights] = useState(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("incidents");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const visibleIncidents = useMemo(
    () =>
      incidents.filter((incident) => {
        const agencyMatch = agencyFilter === "all" || incident.agency_id === agencyFilter;
        const statusMatch = statusFilter === "all" || incident.status === statusFilter;
        const text = `${incident.id} ${incident.title} ${incident.summary} ${incident.category}`.toLowerCase();
        return agencyMatch && statusMatch && text.includes(query.toLowerCase());
      }),
    [incidents, agencyFilter, statusFilter, query],
  );

  // Selection is derived from what's visible, so filters never leave the detail
  // panel showing a hidden incident, and stale rows from a previous selection
  // never flash while the next ones load.
  const selectedIncident =
    visibleIncidents.find((item) => item.id === selectedIncidentId) || visibleIncidents[0];
  const incidentId = selectedIncident?.id;
  const incidentTickets = tickets.filter((ticket) => ticket.incident_id === incidentId);
  const selectedTicket =
    incidentTickets.find((item) => item.id === selectedTicketId) || incidentTickets[0];
  const conversationId = selectedTicket?.conversation_id;
  const conversationMessages = messages.filter((item) => item.conversation_id === conversationId);
  const selectedAgency =
    selectedIncident?.agencies ||
    agencies.find((item) => item.id === selectedIncident?.agency_id);

  // Effects only set state inside promise callbacks, and ignore responses
  // that arrive after the selection changed (a slow reply for the previous
  // incident can't overwrite the current one).
  useEffect(() => {
    if (!supabaseReady) return;
    const refresh = () =>
      fetchDashboard()
        .then((data) => { setIncidents(data.incidents); setAgencies(data.agencies); })
        .catch((loadError) => setError(loadError.message))
        .finally(() => setLoading(false));
    refresh();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Stats + AI briefing for the "Viewing as" agency; refreshed when incidents
  // change (the backend caches the briefing, so this is cheap).
  useEffect(() => {
    if (!supabaseReady) return;
    let current = true;
    fetchInsights(agencyFilter)
      .then((data) => { if (current) setInsights(data); })
      .catch(() => { /* the incident list stays usable without analytics */ });
    return () => { current = false; };
  }, [agencyFilter, incidents]);

  // Reports for the selected incident, kept live: a new report joining the
  // incident appears without clicking away and back.
  useEffect(() => {
    if (!supabaseReady || !incidentId) return;
    let current = true;
    const refresh = () =>
      fetchTickets(incidentId)
        .then((rows) => { if (current) setTickets(rows); })
        .catch((loadError) => { if (current) setError(loadError.message); });
    refresh();
    const channel = supabase
      .channel(`tickets-${incidentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `incident_id=eq.${incidentId}` },
        refresh,
      )
      .subscribe();
    return () => { current = false; supabase.removeChannel(channel); };
  }, [incidentId]);

  // SMS conversation for the selected report, kept live.
  useEffect(() => {
    if (!supabaseReady || !conversationId) return;
    let current = true;
    const refresh = () =>
      fetchMessages(conversationId)
        .then((rows) => { if (current) setMessages(rows); })
        .catch((loadError) => { if (current) setError(loadError.message); });
    refresh();
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        refresh,
      )
      .subscribe();
    return () => { current = false; supabase.removeChannel(channel); };
  }, [conversationId]);

  // After a button press, refresh right away rather than waiting for realtime.
  async function reloadDashboard() {
    const data = await fetchDashboard();
    setIncidents(data.incidents);
    setAgencies(data.agencies);
  }


  function success(text) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 4000);
  }

  function toggleTheme() {
    setDarkMode((current) => {
      const next = !current;
      saveTheme(next ? "dark" : "light");
      return next;
    });
  }

  async function changeIncidentStatus(status) {
    if (!selectedIncident) return;
    setBusy(true); setError("");
    try {
      await api(`/api/incidents/${selectedIncident.id}`, "PATCH", { status });
      setTickets(await fetchTickets(selectedIncident.id)); // reports move with the incident
      success(
        status === "confirmed"
          ? "Incident confirmed. Every reporter was notified."
          : "Incident resolved. Every reporter was notified.",
      );
      await reloadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function beginTicketReview() {
    if (!selectedTicket) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tickets/${selectedTicket.id}`, "PATCH", { status: "in_progress" });
      success("Report moved to review. The reporter was notified.");
      setTickets(await fetchTickets(selectedIncident.id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!selectedTicket || !message.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tickets/${selectedTicket.id}/messages`, "POST", {
        body: message.trim(),
      });
      setMessage("");
      success("SMS sent to the reporter.");
      setMessages(await fetchMessages(selectedTicket.conversation_id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!supabaseReady) return <Setup />;

  const counts = insights?.counts || {};
  return (
    <div className={`shell ${darkMode ? "dark" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span>C4Y</span><div><strong>Community4You</strong><small>LA County response</small></div></div>
        <nav>
          <button className={view === "incidents" ? "active" : ""} onClick={() => setView("incidents")}>▦ Incident queue</button>
          <button className={view === "organizations" ? "active" : ""} onClick={() => setView("organizations")}>◎ Organizations</button>
        </nav>
        <div className="org-list">
          <p>VIEWING AS</p>
          <button className={agencyFilter === "all" ? "selected" : ""} onClick={() => setAgencyFilter("all")}><i className="all"/>All organizations <b>{incidents.filter((item) => item.status !== "resolved").length}</b></button>
          {agencies.map((org) => (
            <button key={org.id} className={agencyFilter === org.id ? "selected" : ""} onClick={() => { setAgencyFilter(org.id); setView("incidents"); }}>
              <i className={org.id}/><span>{org.name}</span>
              <b>{incidents.filter((item) => item.agency_id === org.id && item.status !== "resolved").length}</b>
            </button>
          ))}
        </div>
        <div className="live"><span/> Supabase realtime connected</div>
      </aside>

      <main>
        <header className="topbar">
          <div><p>AGENCY OPERATIONS CENTER</p><h1>{view === "organizations" ? "Organization network" : "Incident command"}</h1></div>
          <div className="top-actions">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search incidents…"/>
            <button className="theme-toggle" onClick={toggleTheme} aria-label={darkMode ? "Use light mode" : "Use dark mode"}>
              {darkMode ? "☀ Light" : "☾ Dark"}
            </button>
            <span className="avatar">MM</span>
          </div>
        </header>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">✓ {notice}</div>}

        {view === "organizations" ? (
          <Organizations agencies={agencies} incidents={incidents} onOpen={(id) => { setAgencyFilter(id); setView("incidents"); }}/>
        ) : (
          <>
            <section className="stats">
              <Stat label="Open incidents" value={counts.openIncidents ?? incidents.filter((item) => item.status !== "resolved").length} sub="Live operations" tone="red"/>
              <Stat label="Reports today" value={counts.reportsLast24h ?? "—"} sub="Last 24 hours" tone="amber"/>
              <Stat label="Hotspots" value={insights?.hotspots?.length ?? incidents.filter((item) => item.report_count > 1).length} sub="Multiple reports" tone="blue"/>
              <Stat label="Resolved today" value={counts.resolvedLast24h ?? "—"} sub="Community impact" tone="green"/>
            </section>

            {insights?.summary && <section className="notice"><strong>AI shift briefing:</strong> {insights.summary}</section>}

            <div className="command-grid">
              <section className="queue card">
                <div className="section-head"><div><span className="pulse"/>LIVE INCIDENTS</div><small>{visibleIncidents.length} incidents</small></div>
                <div className="filters">
                  {[["active", "Needs attention"], ["confirmed", "In progress"], ["resolved", "Resolved"], ["all", "All"]].map(([key, label]) => (
                    <button key={key} className={statusFilter === key ? "active" : ""} onClick={() => setStatusFilter(key)}>{label}</button>
                  ))}
                </div>
                <div className="ticket-list">
                  {loading ? <div className="empty">Loading incidents…</div> : visibleIncidents.map((incident) => (
                    <IncidentCard key={incident.id} incident={incident} active={incident.id === selectedIncident?.id} onClick={() => setSelectedIncidentId(incident.id)}/>
                  ))}
                  {!loading && !visibleIncidents.length && <div className="empty">No incidents match these filters.</div>}
                </div>
              </section>

              <section className="detail card">
                {selectedIncident ? (
                  <>
                    <div className="detail-top">
                      <div>
                        <span className={`priority ${selectedIncident.priority.toLowerCase()}`}>{selectedIncident.priority}</span>
                        <span className={`incident-status ${selectedIncident.status}`}>
                          {selectedIncident.status === "active" && "● NEEDS ATTENTION"}
                          {selectedIncident.status === "confirmed" && "✓ CONFIRMED"}
                          {selectedIncident.status === "resolved" && "✓ RESOLVED"}
                        </span>
                      </div>
                      <span>INCIDENT #{selectedIncident.id}</span>
                    </div>
                    <h2>{selectedIncident.title || selectedIncident.summary}</h2>
                    <p className="location">⌖ {selectedIncident.location_text || "Location compiled from resident reports"}</p>
                    <div className="route">
                      <div className={`agency-mark ${selectedIncident.agency_id}`}>{selectedAgency?.name?.slice(0, 2).toUpperCase()}</div>
                      <div><small>AI ROUTED TO</small><strong>{selectedAgency?.name || selectedIncident.agency_id}</strong><p>{selectedAgency?.description}</p></div>
                      <b>{selectedIncident.report_count} {selectedIncident.report_count === 1 ? "report" : "reports"}</b>
                    </div>
                    <div className="analysis">
                      <div><small>COMBINED AI SUMMARY</small><p>{selectedIncident.summary}</p></div>
                      <div><small>PRIORITY SCORE</small><p>{selectedIncident.priority_score}/100 · {selectedIncident.priority}</p></div>
                    </div>

                    <div className="conversation">
                      <div className="section-head"><div>RESIDENT REPORTS</div><small>{incidentTickets.length} linked</small></div>
                      {incidentTickets.map((ticket) => (
                        <button key={ticket.id} className={`ticket ${ticket.id === selectedTicket?.id ? "active" : ""}`} onClick={() => setSelectedTicketId(ticket.id)}>
                          <div><strong>REPORT #{ticket.id}</strong><time>{relative(ticket.created_at)}</time></div>
                          <p>{ticket.summary}</p>
                          <footer><span>{maskPhone(ticket.phone)}</span><b>{ticket.status}</b>{ticket.is_emergency && <em>🚨 Emergency</em>}</footer>
                        </button>
                      ))}
                    </div>

                    {selectedTicket && (
                      <>
                        <div className="analysis">
                          <div><small>AI SUGGESTS</small><p>{selectedTicket.suggested_action || "Agency review required."}</p></div>
                          <div><small>CREDIBILITY</small><p>{selectedTicket.credibility}{selectedTicket.credibility_reason ? ` — ${selectedTicket.credibility_reason}` : ""}</p></div>
                        </div>
                        <div className="conversation">
                          <div className="section-head"><div>SMS CONVERSATION</div><small>{conversationMessages.length} messages</small></div>
                          {conversationMessages.map((item) => <div key={item.id} className={`bubble ${item.sender}`}><small>{item.sender}</small>{item.body}</div>)}
                        </div>
                        <form className="message-form" onSubmit={sendMessage}>
                          <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Text an update to this resident…"/>
                          <button disabled={busy || !message.trim()}>Send SMS</button>
                        </form>
                      </>
                    )}

                    <div className="actions">
                      {selectedIncident.status === "active" && <button className="review" disabled={busy} onClick={() => changeIncidentStatus("confirmed")}>Confirm incident</button>}
                      {selectedTicket && selectedTicket.status === "new" && <button className="review" disabled={busy} onClick={beginTicketReview}>Review this report</button>}
                      {selectedIncident.status !== "resolved" && <button className="resolve" disabled={busy} onClick={() => changeIncidentStatus("resolved")}>Resolve incident</button>}
                    </div>
                  </>
                ) : <div className="empty">Select an incident.</div>}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function IncidentCard({ incident, active, onClick }) {
  const agencyName = incident.agencies?.name || incident.agency_id;
  return (
    <button className={`ticket ${active ? "active" : ""}`} onClick={onClick}>
      <div><span className={`dot ${incident.priority.toLowerCase()}`}/><strong>#{incident.id} · {categoryNames[incident.category] || incident.category}</strong><time>{relative(incident.last_reported_at)}</time></div>
      <h3>{incident.title || "Community incident"}</h3>
      <p>{incident.summary}</p>
      <footer><span>{agencyName}</span><b>{incident.status}</b><em>{incident.report_count} {incident.report_count === 1 ? "report" : "reports"}</em></footer>
    </button>
  );
}

function Stat({ label, value, sub, tone }) {
  return <article className="stat"><i className={tone}/><div><p>{label}</p><strong>{value}</strong><small>{sub}</small></div></article>;
}

function Organizations({ agencies, incidents, onOpen }) {
  return <section className="network"><div className="network-hero"><p>AI ROUTING DIRECTORY</p><h2>Every incident reaches the team built to solve it.</h2><span>Gemini groups related reports, scores urgency, and routes each incident through Supabase.</span></div><div className="org-cards">{agencies.map((org) => { const active = incidents.filter((item) => item.agency_id === org.id && item.status !== "resolved").length; return <article key={org.id}><div className={`agency-mark ${org.id}`}>{org.name.slice(0,2).toUpperCase()}</div><small>{org.categories?.map((category) => categoryNames[category]).join(", ")}</small><h3>{org.name}</h3><p>{org.description}</p><footer><strong>{active}</strong><span>open incidents</span><button onClick={() => onOpen(org.id)}>Open queue →</button></footer></article>; })}</div></section>;
}

function Setup() {
  return <main className="setup"><span>C4Y</span><h1>Connect the agency dashboard</h1><p>Create <code>agency-dashboard/.env.local</code> with the Supabase URL, publishable key and deployed API URL.</p></main>;
}

// localStorage can throw (blocked storage, some private modes); the theme is
// just a convenience, so fall back to the default instead of crashing.
function readTheme() {
  try { return localStorage.getItem("c4y-theme"); } catch { return null; }
}
function saveTheme(theme) {
  try { localStorage.setItem("c4y-theme", theme); } catch { /* not saved; fine */ }
}

function maskPhone(phone = "") {
  if (phone.startsWith("web:")) return "Web reporter";
  return phone.length >= 4 ? `(•••) •••-${phone.slice(-4)}` : "Anonymous";
}

function relative(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}
