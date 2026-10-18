import { useEffect, useMemo, useRef, useState } from "react";
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
const credibilityLabels = { ok: "✓ Credible", suspicious: "⚠ Suspicious", spam: "⛔ Spam" };
const BASE_TITLE = document.title;
// After a reload, the notification feed starts with this much recent activity.
const RECENT_MS = 2 * 60 * 60 * 1000;

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
      .select("*, agencies(name, description), tickets(id, credibility)")
      .order("priority_score", { ascending: false })
      .order("last_reported_at", { ascending: false }),
    supabase.from("agencies").select("id, name, description, categories").order("name"),
  ]);
  const failure = incidentResult.error || agencyResult.error;
  if (failure) throw new Error(failure.message);
  return { incidents: incidentResult.data || [], agencies: agencyResult.data || [] };
}

// Reports the AI flagged as spam or suspicious, newest first.
async function fetchFlagged() {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .neq("credibility", "ok")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data || [];
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
  const [darkMode, setDarkMode] = useState(() => readSetting("c4y-theme") !== "light");
  const [incidents, setIncidents] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [flagged, setFlagged] = useState([]);
  const [messages, setMessages] = useState([]);
  const [insights, setInsights] = useState(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [selectedFlaggedId, setSelectedFlaggedId] = useState(null);
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [flaggedFilter, setFlaggedFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("incidents");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Live notifications: the feed, how many are unread, the banner for the
  // latest arrivals, and which cards just arrived (they flash once).
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellRing, setBellRing] = useState(0);
  const [banner, setBanner] = useState(null);
  const [fresh, setFresh] = useState(() => new Set());
  // Sound is opt-in (browsers only allow audio after a click). The ref lets the
  // realtime callbacks read the current choice.
  const [soundEnabled, setSoundEnabled] = useState(() => readSetting("c4y-sound") === "on");
  const soundOn = useRef(soundEnabled);
  // What the last refresh contained, so the next one can tell what's new.
  const seen = useRef({ incidents: null, flagged: null });

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

  const visibleFlagged = useMemo(
    () =>
      flagged.filter((ticket) => {
        const agencyMatch = agencyFilter === "all" || ticket.agency_id === agencyFilter;
        const kindMatch = flaggedFilter === "all" || ticket.credibility === flaggedFilter;
        const text = `${ticket.id} ${ticket.summary} ${ticket.subcategory} ${ticket.credibility_reason}`.toLowerCase();
        return agencyMatch && kindMatch && text.includes(query.toLowerCase());
      }),
    [flagged, agencyFilter, flaggedFilter, query],
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
  const selectedFlagged =
    visibleFlagged.find((item) => item.id === selectedFlaggedId) || visibleFlagged[0];
  // The report whose SMS conversation is shown: from the incident or the flagged list.
  const activeTicket = view === "flagged" ? selectedFlagged : selectedTicket;
  const conversationId = activeTicket?.conversation_id;
  const conversationMessages = messages.filter((item) => item.conversation_id === conversationId);
  const selectedAgency =
    selectedIncident?.agencies ||
    agencies.find((item) => item.id === selectedIncident?.agency_id);

  // Effects only set state inside promise callbacks, and ignore responses
  // that arrive after the selection changed (a slow reply for the previous
  // incident can't overwrite the current one).
  //
  // Incidents and flagged reports stay live. Anything that wasn't in the
  // previous refresh becomes a notification; the first load is just the baseline.
  useEffect(() => {
    if (!supabaseReady) return;
    const announce = (events) => {
      if (!events.length) return;
      setNotifications((list) => [...events, ...list].slice(0, 40));
      setUnread((count) => count + events.length);
      setBellRing((count) => count + 1);
      setBanner((current) => nextBanner(current, events));
      if (soundOn.current) playChime(events.some(isUrgent) ? "urgent" : events.some((item) => item.kind === "incident") ? "incident" : "soft");
      const keys = events.map((item) => item.target);
      setFresh((current) => new Set([...current, ...keys]));
      window.setTimeout(() => setFresh((current) => new Set([...current].filter((key) => !keys.includes(key)))), 4000);
    };
    // First load: recent activity goes in the feed as already read, so a
    // reload never empties it.
    const backfill = (items) =>
      setNotifications((list) => [...list, ...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40));
    const refreshIncidents = () =>
      fetchDashboard()
        .then((data) => {
          const previous = seen.current.incidents;
          seen.current.incidents = new Map(data.incidents.map((item) => [item.id, item.report_count]));
          setIncidents(data.incidents);
          setAgencies(data.agencies);
          if (previous) announce(incidentEvents(previous, data.incidents));
          else backfill(recentIncidentEvents(data.incidents));
        })
        .catch((loadError) => setError(loadError.message))
        .finally(() => setLoading(false));
    const refreshFlagged = () =>
      fetchFlagged()
        .then((rows) => {
          const previous = seen.current.flagged;
          seen.current.flagged = new Set(rows.map((item) => item.id));
          setFlagged(rows);
          if (previous) announce(flaggedEvents(previous, rows));
          else backfill(recentFlaggedEvents(rows));
        })
        .catch((loadError) => setError(loadError.message));
    const refreshAll = () => { refreshIncidents(); refreshFlagged(); };
    refreshAll();
    // Realtime misses events while its socket is down (background tabs often
    // drop it), so catch up on reconnect, when the tab comes back, and every minute.
    let joined = false;
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, refreshIncidents)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refreshFlagged)
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (joined) refreshAll();
        joined = true;
      });
    const onVisible = () => { if (document.visibilityState === "visible") refreshAll(); };
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(refreshAll, 60_000);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, []);

  // Browsers keep audio locked until the page gets a click or key press.
  useEffect(() => {
    const unlock = () => { if (soundOn.current) unlockAudio(); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Unread count in the tab title, so new activity shows from other tabs.
  useEffect(() => {
    document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unread]);

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
      saveSetting("c4y-theme", next ? "dark" : "light");
      return next;
    });
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundOn.current = next;
    saveSetting("c4y-sound", next ? "on" : "off");
    if (next) { unlockAudio(); playChime("soft"); }
  }

  function toggleBell() {
    setBellOpen((open) => !open);
    setUnread(0);
  }

  // Jump to what a notification is about, widening the filters if they hide it.
  function openNotification(item) {
    setBellOpen(false);
    setBanner(null);
    if (item.kind === "flagged") {
      setView("flagged");
      if (!visibleFlagged.some((ticket) => ticket.id === item.targetId)) {
        setAgencyFilter("all"); setFlaggedFilter("all"); setQuery("");
      }
      setSelectedFlaggedId(item.targetId);
      return;
    }
    setView("incidents");
    if (!visibleIncidents.some((incident) => incident.id === item.targetId)) {
      setAgencyFilter("all"); setStatusFilter("all"); setQuery("");
    }
    setSelectedIncidentId(item.targetId);
  }

  function openIncident(id) {
    setView("incidents");
    if (!visibleIncidents.some((incident) => incident.id === id)) {
      setAgencyFilter("all"); setStatusFilter("all"); setQuery("");
    }
    setSelectedIncidentId(id);
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

  // "Not spam": clears the AI's flag; the backend then groups the report into an incident.
  async function clearFlag() {
    if (!selectedFlagged) return;
    const ticket = selectedFlagged;
    setBusy(true); setError("");
    try {
      await api(`/api/tickets/${ticket.id}`, "PATCH", { credibility: "ok" });
      success(
        ticket.incident_id
          ? `Report #${ticket.id} marked credible. Incident #${ticket.incident_id} is being updated.`
          : `Report #${ticket.id} marked credible. It will join the incident queue in a few seconds.`,
      );
      setFlagged(await fetchFlagged());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!activeTicket || !message.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tickets/${activeTicket.id}/messages`, "POST", {
        body: message.trim(),
      });
      setMessage("");
      success("SMS sent to the reporter.");
      setMessages(await fetchMessages(activeTicket.conversation_id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!supabaseReady) return <Setup />;

  const counts = insights?.counts || {};
  const conversationPanel = activeTicket && (
    <>
      <div className="conversation">
        <div className="section-head"><div>SMS CONVERSATION</div><small>{conversationMessages.length} messages</small></div>
        {conversationMessages.map((item) => <div key={item.id} className={`bubble ${item.sender}`}><small>{item.sender}</small>{item.body}</div>)}
      </div>
      <form className="message-form" onSubmit={sendMessage}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Text an update to this resident…"/>
        <button disabled={busy || !message.trim()}>Send SMS</button>
      </form>
    </>
  );
  const incidentFlagBadge = selectedIncident && incidentFlag(selectedIncident);
  return (
    <div className={`shell ${darkMode ? "dark" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span>C4Y</span><div><strong>Community4You</strong><small>LA County response</small></div></div>
        <nav>
          <button className={view === "incidents" ? "active" : ""} onClick={() => setView("incidents")}>▦ Incident queue</button>
          <button className={view === "flagged" ? "active" : ""} onClick={() => setView("flagged")}>
            ⚑ Flagged reports {flagged.length > 0 && <b className="nav-count">{flagged.length}</b>}
          </button>
          <button className={view === "organizations" ? "active" : ""} onClick={() => setView("organizations")}>◎ Organizations</button>
        </nav>
        <div className="org-list">
          <p>VIEWING AS</p>
          <button className={agencyFilter === "all" ? "selected" : ""} onClick={() => setAgencyFilter("all")}><i className="all"/>All organizations <b>{incidents.filter((item) => item.status !== "resolved").length}</b></button>
          {agencies.map((org) => (
            <button key={org.id} className={agencyFilter === org.id ? "selected" : ""} onClick={() => { setAgencyFilter(org.id); if (view === "organizations") setView("incidents"); }}>
              <i className={org.id}/><span>{org.name}</span>
              <b>{incidents.filter((item) => item.agency_id === org.id && item.status !== "resolved").length}</b>
            </button>
          ))}
        </div>
        <div className="live"><span/> Supabase realtime connected</div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p>AGENCY OPERATIONS CENTER</p>
            <h1>{view === "organizations" ? "Organization network" : view === "flagged" ? "Flagged reports" : "Incident command"}</h1>
          </div>
          <div className="top-actions">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "flagged" ? "Search reports…" : "Search incidents…"}/>
            <NotificationBell
              open={bellOpen}
              unread={unread}
              ring={bellRing}
              items={notifications}
              onToggle={toggleBell}
              onOpen={openNotification}
              onClear={() => { setNotifications([]); setUnread(0); }}
            />
            <button className={`sound-toggle ${soundEnabled ? "on" : ""}`} onClick={toggleSound} aria-pressed={soundEnabled} aria-label={soundEnabled ? "Mute notification sounds" : "Turn on notification sounds"} title={soundEnabled ? "Sound on" : "Sound off"}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4z"/>
                {soundEnabled ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/> : <path d="m22 9-6 6M16 9l6 6"/>}
              </svg>
            </button>
            <button className="theme-toggle" onClick={toggleTheme} aria-label={darkMode ? "Use light mode" : "Use dark mode"}>
              {darkMode ? "☀ Light" : "☾ Dark"}
            </button>
            <span className="avatar">MM</span>
          </div>
        </header>
        <div className="banner-slot">
          {banner && (
            <div key={banner.key} className={`banner ${banner.lead.kind} ${banner.urgent ? "urgent" : ""}`} role={banner.urgent ? "alert" : "status"}>
              <span className="toast-icon">{notificationIcons[banner.lead.kind]}</span>
              <p>
                <strong>{banner.lead.title}</strong>
                <span>{banner.lead.text}</span>
                {banner.count > 1 && <em>+{banner.count - 1} more</em>}
              </p>
              <button className="banner-view" onClick={() => openNotification(banner.lead)}>View</button>
              <button className="banner-close" aria-label="Dismiss" onClick={() => setBanner(null)}>×</button>
              {/* Routine banners leave on their own (paused while hovered); urgent ones stay until handled. */}
              {!banner.urgent && <i key={banner.id} className="banner-timer" onAnimationEnd={() => setBanner(null)}/>}
            </div>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">✓ {notice}</div>}

        {view === "organizations" ? (
          <Organizations agencies={agencies} incidents={incidents} onOpen={(id) => { setAgencyFilter(id); setView("incidents"); }}/>
        ) : view === "flagged" ? (
          <div className="command-grid">
            <section className="queue card">
              <div className="section-head"><div><span className="pulse flagged"/>FLAGGED BY AI</div><small>{visibleFlagged.length} reports</small></div>
              <div className="filters">
                {[["all", "All flagged"], ["spam", "Spam"], ["suspicious", "Suspicious"]].map(([key, label]) => (
                  <button key={key} className={flaggedFilter === key ? "active" : ""} onClick={() => setFlaggedFilter(key)}>{label}</button>
                ))}
              </div>
              <div className="ticket-list">
                {visibleFlagged.map((ticket) => (
                  <button key={ticket.id} className={`ticket ${ticket.id === selectedFlagged?.id ? "active" : ""} ${fresh.has(`ticket-${ticket.id}`) ? "fresh" : ""}`} onClick={() => setSelectedFlaggedId(ticket.id)}>
                    <div><span className={`dot ${ticket.priority.toLowerCase()}`}/><strong>Report #{ticket.id} · {categoryNames[ticket.category] || ticket.category}</strong><time>{relative(ticket.created_at)}</time></div>
                    <h3>{ticket.subcategory}</h3>
                    <p>{ticket.summary}</p>
                    <footer><CredibilityBadge value={ticket.credibility}/>{ticket.is_emergency && <em>🚨 Emergency</em>}<b>{ticket.incident_id ? `Incident #${ticket.incident_id}` : "Not in queue"}</b></footer>
                  </button>
                ))}
                {!visibleFlagged.length && <div className="empty">No flagged reports. The AI hasn't flagged anything matching these filters.</div>}
              </div>
            </section>

            <section className="detail card">
              {selectedFlagged ? (
                <>
                  <div className="detail-top">
                    <div>
                      <CredibilityBadge value={selectedFlagged.credibility} large/>
                      <span className={`priority ${selectedFlagged.priority.toLowerCase()}`}>{selectedFlagged.priority}</span>
                      {selectedFlagged.is_emergency && <span className="priority critical">🚨 EMERGENCY</span>}
                    </div>
                    <span>REPORT #{selectedFlagged.id}</span>
                  </div>
                  <h2>{selectedFlagged.summary}</h2>
                  <p className="location">⌖ {selectedFlagged.location_text || "No location given"} · {maskPhone(selectedFlagged.phone)} · {relative(selectedFlagged.created_at)}</p>
                  <div className={`flag-reason ${selectedFlagged.credibility}`}>
                    <small>WHY THE AI FLAGGED IT</small>
                    <p>{selectedFlagged.credibility_reason || "No reason given."}</p>
                  </div>
                  <div className="analysis">
                    <div><small>AI WOULD ROUTE TO</small><p>{agencies.find((item) => item.id === selectedFlagged.agency_id)?.name || selectedFlagged.agency_id} · {selectedFlagged.subcategory}</p></div>
                    <div>
                      <small>INCIDENT QUEUE</small>
                      <p>
                        {selectedFlagged.incident_id
                          ? <>In incident #{selectedFlagged.incident_id} (emergencies always reach the queue). <button className="link" onClick={() => openIncident(selectedFlagged.incident_id)}>Open →</button></>
                          : "Held back. Not spam sends it to the queue."}
                      </p>
                    </div>
                  </div>
                  {conversationPanel}
                  <div className="actions">
                    <button className="review" disabled={busy} onClick={clearFlag}>
                      {selectedFlagged.credibility === "spam" ? "Not spam" : "Mark credible"}
                    </button>
                  </div>
                </>
              ) : <div className="empty">Nothing flagged. Spam and suspicious reports show up here.</div>}
            </section>
          </div>
        ) : (
          <>
            <section className="stats">
              <Stat label="Open incidents" value={counts.openIncidents ?? incidents.filter((item) => item.status !== "resolved").length} sub="Live operations" tone="red"/>
              <Stat label="Reports today" value={counts.reportsLast24h ?? "—"} sub="Last 24 hours" tone="amber"/>
              <Stat label="Hotspots" value={insights?.hotspots?.length ?? incidents.filter((item) => item.report_count > 1).length} sub="Multiple reports" tone="blue"/>
              <Stat label="Resolved today" value={counts.resolvedLast24h ?? "—"} sub="Community impact" tone="green"/>
            </section>

            {insights?.summary && (
              <section className="briefing">
                <small><span aria-hidden="true">✦</span> RECOMMENDATION</small>
                <p>{insights.summary}</p>
              </section>
            )}

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
                    <IncidentCard key={incident.id} incident={incident} active={incident.id === selectedIncident?.id} fresh={fresh.has(`incident-${incident.id}`)} onClick={() => setSelectedIncidentId(incident.id)}/>
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
                        {incidentFlagBadge && <span className={`cred large ${incidentFlagBadge.tone}`}>{incidentFlagBadge.label}</span>}
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
                          <footer><span>{maskPhone(ticket.phone)}</span><CredibilityBadge value={ticket.credibility}/><b>{ticket.status}</b>{ticket.is_emergency && <em>🚨 Emergency</em>}</footer>
                        </button>
                      ))}
                    </div>

                    {selectedTicket && (
                      <>
                        <div className="analysis">
                          <div><small>AI SUGGESTS</small><p>{selectedTicket.suggested_action || "Agency review required."}</p></div>
                          <div><small>CREDIBILITY</small><p><CredibilityBadge value={selectedTicket.credibility}/>{selectedTicket.credibility_reason ? ` ${selectedTicket.credibility_reason}` : ""}</p></div>
                        </div>
                        {conversationPanel}
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

const notificationIcons = { incident: "✦", report: "＋", flagged: "⚑" };

function NotificationBell({ open, unread, ring, items, onToggle, onOpen, onClear }) {
  return (
    <div className="bell-wrap">
      <button className={`bell ${unread ? "has-unread" : ""}`} onClick={onToggle} aria-label={`Notifications${unread ? `, ${unread} new` : ""}`} aria-expanded={open}>
        <svg key={`ring-${ring}`} className={`bell-icon ${ring ? "ring" : ""}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        {unread > 0 && <b key={`count-${unread}`}>{unread > 9 ? "9+" : unread}</b>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="section-head"><div><span className="pulse"/>LIVE ACTIVITY</div>{items.length > 0 && <button className="link" onClick={onClear}>Clear</button>}</div>
          {items.length ? items.map((item) => (
            <button key={item.id} className={`notif-item ${item.kind} ${item.priority === "CRITICAL" ? "urgent" : ""}`} onClick={() => onOpen(item)}>
              <span className="toast-icon">{notificationIcons[item.kind]}</span>
              <span><strong>{item.title}</strong><small>{item.text}</small></span>
              <time>{relative(item.at)}</time>
            </button>
          )) : <div className="empty">New incidents, reports and flags will appear here as they come in.</div>}
        </div>
      )}
    </div>
  );
}

function CredibilityBadge({ value, large = false }) {
  return <span className={`cred ${value} ${large ? "large" : ""}`}>{credibilityLabels[value] || value}</span>;
}

// Badge for an incident whose reports the AI flagged: all spam, or some flagged.
function incidentFlag(incident) {
  const reports = incident.tickets || [];
  const flaggedCount = reports.filter((ticket) => ticket.credibility !== "ok").length;
  if (!flaggedCount) return null;
  if (reports.every((ticket) => ticket.credibility === "spam")) return { tone: "spam", label: credibilityLabels.spam };
  if (flaggedCount === reports.length) return { tone: "suspicious", label: credibilityLabels.suspicious };
  return { tone: "suspicious", label: `⚠ ${flaggedCount} of ${reports.length} flagged` };
}

// Notifications are diffs between two refreshes.
let notificationId = 0;
function notification(kind, targetId, title, text, priority, at = new Date().toISOString()) {
  notificationId += 1;
  const target = `${kind === "flagged" ? "ticket" : "incident"}-${targetId}`;
  return { id: notificationId, kind, targetId, target, title, text, priority, at };
}

const isUrgent = (item) => item.priority === "CRITICAL";

// Events arriving while a banner is up join it ("+2 more"). An urgent event
// takes the lead and makes the banner stay until it's handled.
function nextBanner(current, events) {
  const urgent = events.find(isUrgent);
  return {
    key: current?.key ?? events[0].id,
    id: events[0].id,
    lead: urgent || (current?.urgent ? current.lead : events[0]),
    urgent: Boolean(urgent || current?.urgent),
    count: (current?.count || 0) + events.length,
  };
}

function recentIncidentEvents(incidents) {
  const since = Date.now() - RECENT_MS;
  const events = [];
  for (const incident of incidents) {
    if (Date.parse(incident.created_at) >= since) {
      events.push(notification("incident", incident.id, `New incident #${incident.id}`, `${incident.priority} · ${incident.title}`, incident.priority, incident.created_at));
    } else if (incident.report_count > 1 && Date.parse(incident.last_reported_at) >= since) {
      events.push(notification("report", incident.id, `New report on incident #${incident.id}`, `${incident.title} · ${incident.report_count} reports`, incident.priority, incident.last_reported_at));
    }
  }
  return events;
}

function recentFlaggedEvents(rows) {
  const since = Date.now() - RECENT_MS;
  return rows
    .filter((ticket) => Date.parse(ticket.created_at) >= since)
    .map((ticket) => notification("flagged", ticket.id, `Report #${ticket.id} flagged ${ticket.credibility}`, ticket.summary, ticket.is_emergency ? "CRITICAL" : null, ticket.created_at));
}

// Notification chimes, synthesized so there are no sound files to ship.
let audio = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null; // no Web Audio; stay silent
  }
}

const CHIMES = {
  soft: [[740, 0]],
  incident: [[660, 0], [880, 0.14]],
  urgent: [[880, 0], [880, 0.18], [880, 0.36]],
};
function playChime(kind) {
  if (!audio) return;
  const start = audio.currentTime;
  for (const [frequency, offset] of CHIMES[kind]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = kind === "urgent" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.35);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.4);
  }
}

function incidentEvents(previous, incidents) {
  const events = [];
  for (const incident of incidents) {
    const before = previous.get(incident.id);
    if (before === undefined) {
      events.push(notification("incident", incident.id, `New incident #${incident.id}`, `${incident.priority} · ${incident.title}`, incident.priority));
    } else if (incident.report_count > before) {
      events.push(notification("report", incident.id, `New report on incident #${incident.id}`, `${incident.title} · ${incident.report_count} reports`, incident.priority));
    }
  }
  return events;
}

function flaggedEvents(previous, rows) {
  return rows
    .filter((ticket) => !previous.has(ticket.id))
    .map((ticket) => notification("flagged", ticket.id, `Report #${ticket.id} flagged ${ticket.credibility}`, ticket.summary, ticket.is_emergency ? "CRITICAL" : null));
}

function IncidentCard({ incident, active, fresh, onClick }) {
  const agencyName = incident.agencies?.name || incident.agency_id;
  const flag = incidentFlag(incident);
  return (
    <button className={`ticket ${active ? "active" : ""} ${fresh ? "fresh" : ""}`} onClick={onClick}>
      <div><span className={`dot ${incident.priority.toLowerCase()}`}/><strong>#{incident.id} · {categoryNames[incident.category] || incident.category}</strong><time>{relative(incident.last_reported_at)}</time></div>
      <h3>{incident.title || "Community incident"}</h3>
      <p>{incident.summary}</p>
      <footer><span>{agencyName}</span>{flag && <span className={`cred ${flag.tone}`}>{flag.label}</span>}<b>{incident.status}</b><em>{incident.report_count} {incident.report_count === 1 ? "report" : "reports"}</em></footer>
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

// localStorage can throw (blocked storage, some private modes); theme and
// sound are just conveniences, so fall back to the default instead of crashing.
function readSetting(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not saved; fine */ }
}

function maskPhone(phone = "") {
  if (phone.startsWith("web:")) return "Web reporter";
  return phone.length >= 4 ? `(•••) •••-${phone.slice(-4)}` : "Anonymous";
}

function relative(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}
