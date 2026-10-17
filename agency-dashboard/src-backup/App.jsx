import { useMemo, useState } from "react";
import "./App.css";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import ReportCard from "./components/ReportCard";
import Icon from "./components/Icon";
import { initialReports } from "./data/reports";

const filters = ["All reports", "Critical", "High", "Unverified"];

export default function App() {
  const [reports, setReports] = useState(initialReports);
  const [selectedId, setSelectedId] = useState(initialReports[0].id);
  const [filter, setFilter] = useState("All reports");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const selected = reports.find((report) => report.id === selectedId) || reports[0];
  const visibleReports = useMemo(() => reports.filter((report) => {
    const matchesFilter = filter === "All reports" || report.priority === filter || report.status === filter;
    const searchable = `${report.title} ${report.location} ${report.id} ${report.category}`.toLowerCase();
    return matchesFilter && searchable.includes(query.toLowerCase());
  }), [reports, filter, query]);

  function updateStatus(status) {
    setReports((items) => items.map((item) => item.id === selected.id ? { ...item, status } : item));
    setToast(status === "Verified" ? "Report verified and ready to publish." : "Report rejected and removed from the public queue.");
    window.setTimeout(() => setToast(""), 3000);
  }

  return <div className="app-shell">
    <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
    <div className="app-main">
      <Navbar query={query} setQuery={setQuery} onMenu={() => setMenuOpen(true)} />
      <main className="dashboard">
        <header className="welcome-row"><div><span className="eyebrow">COMMUNITY OPERATIONS CENTER</span><h1>Good afternoon, Montserrat.</h1><p>Here’s what needs your team’s attention in Monterey County.</p></div><button className="primary-button"><Icon name="megaphone" /> Publish alert</button></header>
        <section className="metrics-grid" aria-label="Report summary">
          <Metric icon="warning" label="Needs verification" value="12" note="4 critical" tone="red" />
          <Metric icon="radio" label="Active incidents" value="8" note="2 added today" tone="orange" />
          <Metric icon="check" label="Resolved this week" value="47" note="↑ 18% from last week" tone="green" />
          <Metric icon="users" label="Residents reached" value="12.4k" note="Across 6 alerts" tone="blue" />
        </section>
        <section className="workspace-grid">
          <div className="queue-panel panel">
            <div className="panel-heading"><div><span className="live-dot" /> LIVE QUEUE</div><button>View all <span>›</span></button></div>
            <div className="filter-row">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
            <div className="report-list">{visibleReports.map((report) => <ReportCard key={report.id} report={report} selected={report.id === selected.id} onSelect={setSelectedId} />)}{!visibleReports.length && <div className="empty-state">No reports match your search.</div>}</div>
          </div>
          <article className="detail-panel panel">
            <div className="incident-map" aria-label="Incident map preview">
              <span className="road road-one" /><span className="road road-two" /><span className="road road-three" /><span className="road road-four" />
              {reports.map((report) => <button key={report.id} aria-label={`Select ${report.title}`} onClick={() => setSelectedId(report.id)} className={`map-pin ${report.priority.toLowerCase()} ${selected.id === report.id ? "active" : ""}`} style={{ left: `${report.coordinates.x}%`, top: `${report.coordinates.y}%` }}><i /></button>)}
              <span className="map-city">SALINAS</span><span className="map-street street-one">Natividad Rd</span><span className="map-street street-two">E Alisal St</span><button className="expand-map">Expand map ↗</button>
            </div>
            <div className="detail-content">
              <div className="detail-labels"><span className={`priority ${selected.priority.toLowerCase()}`}>{selected.priority}</span><span className={`status ${selected.status.toLowerCase().replace(" ", "-")}`}>● {selected.status}</span></div>
              <p className="report-id">{selected.id} · VIA {selected.source.toUpperCase()}</p><h2>{selected.title}</h2><p className="description">{selected.description}</p>
              <div className="fact-grid"><Fact icon="pin" label="LOCATION" value={selected.location} /><Fact icon="clock" label="REPORTED" value={selected.time} /><Fact icon="shield" label="AI CONFIDENCE" value={`${selected.confidence}% match`} /><Fact icon="folder" label="CATEGORY" value={selected.category} /></div>
              <div className="corroboration"><div className="avatar-stack"><span>1</span><span>2</span><span>3</span></div><div><strong>Corroborated by {selected.reports} nearby {selected.reports === 1 ? "report" : "reports"}</strong><p>Details and location appear consistent.</p></div><span className="chevron">›</span></div>
              <div className="detail-actions"><button className="reject-button" onClick={() => updateStatus("Rejected")}>× Reject</button><button className="contact-button"><Icon name="phone" /> Contact</button><button className="verify-button" onClick={() => updateStatus("Verified")}><Icon name="check" /> Verify report</button></div>
            </div>
          </article>
        </section>
        <section className="lower-grid">
          <div className="activity-panel panel"><div className="panel-title"><div><h2>Response activity</h2><p>Average verification time this week</p></div><strong>14m <small>↓ 22%</small></strong></div><div className="bars">{[38,55,43,76,62,86,69].map((height,index)=><div key={index}><span style={{height:`${height}%`}} /><small>{["S","M","T","W","T","F","S"][index]}</small></div>)}</div></div>
          <div className="impact-panel panel"><div className="impact-icon"><Icon name="shield" /></div><div><span className="eyebrow">YOUR TEAM’S IMPACT</span><h2>Information reached 2,340 residents</h2><p>Through 15 verified alerts this month.</p></div><button>View impact ↗</button></div>
        </section>
      </main>
    </div>
    {toast && <div className="toast"><Icon name="check" /> {toast}</div>}
  </div>;
}

function Metric({ icon, label, value, note, tone }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} /></div><div><p>{label}</p><strong>{value}</strong><span>{note}</span></div></div>; }
function Fact({ icon, label, value }) { return <div><Icon name={icon} /><span><small>{label}</small><strong>{value}</strong></span></div>; }

