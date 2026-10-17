export default function Sidebar() {
  return (
    <div
      style={{
        width: "250px",
        backgroundColor: "#1e293b",
        color: "white",
        minHeight: "100vh",
        padding: "20px",
      }}
    >
      <h2>Dashboard</h2>

      <p>📊 Overview</p>

      <p>📥 Reports</p>

      <p>📢 Alerts</p>

      <p>🤝 Resources</p>

      <p>🏢 Organizations</p>

      <p>⚙ Settings</p>
    </div>
  );
}