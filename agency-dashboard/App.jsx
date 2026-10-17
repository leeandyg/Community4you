import { useMemo, useState } from "react";
import "./App.css";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import ReportCard from "./components/ReportCard";
import Icon from "./components/Icon";
import { initialReports } from "./data/reports";
import { organizations, routeReport } from "./data/routing";
import { analyzeReport } from "./services/routingService";

const filters = ["All reports", "Critical", "High", "Unverified"];

export default function App() {
  const [reports, setReports] = useState(initialReports);
  const [selectedId, setSelectedId] = useState(initialReports[0].id);
  const [filter, setFilter] = useState("All reports");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState("Overview");
  const [toast, setToast] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const selected = reports.find((report) => report.id === selectedId) || reports[0];
  const route = routeReport(selected.category);

  const visibleReports = useMemo(() => reports.filter((report) => {
    const matchesFilter = filter === "All reports" || report.priority === filter || report.status === filter;
    return matchesFilter && `${report.title} ${report.location} ${report.id} ${report.category}`.toLowerCase().includes(query.toLowerCase());
  }), [reports, filter, query]);

  function showToast(message) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  function updateStatus(status) {
    setReports((items) => items.map((item) => item.id === selected.id ? { ...item, status } : item));
    showToast(status === "Verified" ? "Second check passed — report verified." : "Report rejected and removed from the public queue.");
  }
  function simulateAlert() {
    const raw = { id:"RPT-2847", title:"Large pothole blocking traffic", description:"A deep pothole is forcing cars into the next lane near a busy intersection. Another driver reported the same road hazard.", location:"Sunset Blvd & N Western Ave", locationData:{lat:34.0982,lng:-118.3092}, submittedAt:new Date().toISOString(), status:"Unverified", time:"Just now", source:"SMS", coordinates:{x:29,y:34} };
    const incoming = analyzeReport(raw, reports);
    setReports((items) => items.some((item) => item.id === incoming.id) ? items : [incoming, ...items]);
    setSelectedId(incoming.id); setDemoOpen(true); setActiveView("Overview");
  }
  function publishAlert() {
    if (selected.status !== "Verified") { showToast("Verify this report before publishing it publicly."); setPublishOpen(false); return; }
    setPublishOpen(false); showToast("Published to the public map, web feed, and SMS subscribers.");
  }
  function navigate(view) { setActiveView(view); document.querySelector(".dashboard")?.scrollTo?.(0,0); }

  return <div className="app-shell">
    <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={navigate} activeView={activeView} />
    {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
    <div className="app-main">
      <Navbar query={query} setQuery={setQuery} onMenu={() => setMenuOpen(true)} />
      <main className="dashboard">
        <header className="welcome-row"><div><span className="eyebrow">LA COUNTY RAPID RESPONSE</span><h1>{activeView === "Organizations" ? "Organization network" : "Good afternoon, Montserrat."}</h1><p>{activeView === "Organizations" ? "Every report is matched by service type, jurisdiction, and urgency." : "Here’s what needs your team’s attention across Los Angeles."}</p></div><div className="header-actions"><button className="demo-button" onClick={simulateAlert}>▶ Demo incoming alert</button><button className="primary-button" onClick={()=>setPublishOpen(true)}><Icon name="megaphone" /> Publish alert</button></div></header>

        {activeView === "Organizations" ? <OrganizationNetwork /> : <>
          <section className="metrics-grid" aria-label="Report summary"><Metric icon="warning" label="Needs verification" value="12" note="4 critical" tone="red" /><Metric icon="radio" label="Active incidents" value="8" note="2 added today" tone="orange" /><Metric icon="check" label="Resolved this week" value="47" note="↑ 18% from last week" tone="green" /><Metric icon="users" label="Residents reached" value="12.4k" note="Across 6 alerts" tone="blue" /></section>
          <section className="workspace-grid">
            <div className="queue-panel panel"><div className="panel-heading"><div><span className="live-dot" /> LIVE QUEUE</div><button>View all <span>›</span></button></div><div className="filter-row">{filters.map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}</button>)}</div><div className="report-list">{visibleReports.map((report)=><ReportCard key={report.id} report={report} selected={report.id===selected.id} onSelect={setSelectedId} />)}{!visibleReports.length&&<div className="empty-state">No reports match your search.</div>}</div></div>
            <article className="detail-panel panel">
              <div className="incident-map" aria-label="Incident map preview"><span className="road road-one"/><span className="road road-two"/><span className="road road-three"/><span className="road road-four"/>{reports.map((report)=><button key={report.id} aria-label={`Select ${report.title}`} onClick={()=>setSelectedId(report.id)} className={`map-pin ${report.priority.toLowerCase()} ${selected.id===report.id?"active":""}`} style={{left:`${report.coordinates.x}%`,top:`${report.coordinates.y}%`}}><i/></button>)}<span className="map-city">LOS ANGELES</span><span className="map-street street-one">Western Ave</span><span className="map-street street-two">W 3rd St</span><button className="expand-map">Expand map ↗</button></div>
              <div className="detail-content"><div className="detail-labels"><span className={`priority ${selected.priority.toLowerCase()}`}>{selected.priority}</span><span className={`status ${selected.status.toLowerCase().replace(" ","-")}`}>● {selected.status}</span></div><p className="report-id">{selected.id} · VIA {selected.source.toUpperCase()}</p><h2>{selected.title}</h2><p className="description">{selected.description}</p>
                <div className="ai-pipeline"><div className="ai-step done"><span>AI 1</span><div><small>ROUTING AI</small><strong>{selected.category}</strong><p>{selected.confidence}% classification confidence</p></div></div><b>→</b><div className="ai-step verified"><span>AI 2</span><div><small>VERIFICATION AI</small><strong>Evidence consistent</strong><p>{selected.verification}% verification confidence</p></div></div></div>
                <div className="route-card"><div className="org-logo" style={{background:route.color}}>{route.short}</div><div><small>BEST ORGANIZATION MATCH</small><strong>{route.name}</strong><p>{route.services}</p></div><span className="route-score">{selected.confidence}% match</span></div>
                <div className="fact-grid"><Fact icon="pin" label="LOCATION" value={selected.location}/><Fact icon="phone" label="CONTACT" value={route.phone}/><Fact icon="shield" label="SECOND AI CHECK" value={`${selected.verification}% passed`}/><Fact icon="folder" label="CATEGORY" value={selected.category}/></div>
                <div className="detail-actions"><button className="reject-button" onClick={()=>updateStatus("Rejected")}>× Reject</button><a className="contact-button" href={route.url} target="_blank" rel="noreferrer"><Icon name="phone"/> Contact</a><button className="verify-button" onClick={()=>updateStatus("Verified")}><Icon name="check"/> Verify report</button></div>
              </div>
            </article>
          </section>
          <section className="lower-grid"><div className="activity-panel panel"><div className="panel-title"><div><h2>Response activity</h2><p>Average verification time this week</p></div><strong>14m <small>↓ 22%</small></strong></div><div className="bars">{[38,55,43,76,62,86,69].map((height,index)=><div key={index}><span style={{height:`${height}%`}}/><small>{["S","M","T","W","T","F","S"][index]}</small></div>)}</div></div><div className="impact-panel panel"><div className="impact-icon"><Icon name="shield"/></div><div><span className="eyebrow">YOUR TEAM’S IMPACT</span><h2>Information reached 2,340 residents</h2><p>Through 15 verified alerts this month.</p></div><button onClick={()=>navigate("Organizations")}>View network ↗</button></div></section>
        </>}
      </main>
    </div>
    {demoOpen&&<Modal title="Live routing demo" onClose={()=>setDemoOpen(false)}><div className="demo-flow"><div><span>1</span><small>SMS RECEIVED</small><strong>“Large pothole blocking traffic…”</strong></div><b>→</b><div><span>2</span><small>AI CLASSIFIED</small><strong>{selected.category} · {selected.confidence}%</strong></div><b>→</b><div><span>3</span><small>DUPLICATE CHECK</small><strong>{selected.duplicateMatches?.length || 0} nearby match found</strong></div><b>→</b><div><span>4</span><small>ROUTED INSTANTLY</small><strong>{route.name}</strong></div></div><p className="modal-note">Priority: <strong>{selected.priority}</strong> ({selected.priorityScore}/100). The organization receives a structured case now. The public only sees it after human approval.</p><button className="verify-button modal-action" onClick={()=>setDemoOpen(false)}>Open routed report</button></Modal>}
    {publishOpen&&<Modal title="Publish public alert" onClose={()=>setPublishOpen(false)}><div className="publish-card"><span className={`status ${selected.status.toLowerCase()}`}>● {selected.status}</span><h3>{selected.title}</h3><p>{selected.location}</p></div><p className="modal-note">This publishes to the public website map, the live alerts feed, subscribed SMS users, and participating community organizations. Reporter identity and private contact details are never shown.</p><div className="channel-list"><span>✓ Public alert map</span><span>✓ Website feed</span><span>✓ SMS subscribers</span><span>✓ Partner network</span></div><button className="verify-button modal-action" onClick={publishAlert}>Publish to public channels</button></Modal>}
    {toast&&<div className="toast"><Icon name="check"/> {toast}</div>}
  </div>;
}

function OrganizationNetwork(){return <section className="organization-view"><div className="routing-banner"><span>AI ROUTING DIRECTORY</span><h2>One report. The right response team.</h2><p>Routing AI scores service fit, location coverage, urgency, and agency availability. Verification AI independently checks the evidence before public release.</p></div><div className="org-grid">{Object.entries(organizations).map(([category,org])=><article className="org-card" key={category}><div className="org-card-top"><div className="org-logo" style={{background:org.color}}>{org.short}</div><span className="online-dot">● ACTIVE</span></div><small>{category.toUpperCase()}</small><h3>{org.name}</h3><p>{org.services}</p><dl><div><dt>Coverage</dt><dd>{org.coverage}</dd></div><div><dt>Contact</dt><dd>{org.phone}</dd></div></dl><a href={org.url} target="_blank" rel="noreferrer">Open official service ↗</a></article>)}</div></section>}
function Modal({title,onClose,children}){return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event)=>event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">LA COUNTY RAPID RESPONSE</span><h2>{title}</h2></div><button onClick={onClose}>×</button></div>{children}</section></div>}
function Metric({icon,label,value,note,tone}){return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon}/></div><div><p>{label}</p><strong>{value}</strong><span>{note}</span></div></div>}
function Fact({icon,label,value}){return <div><Icon name={icon}/><span><small>{label}</small><strong>{value}</strong></span></div>}
