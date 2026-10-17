export default function Navbar() {
  return (
    <nav
      style={{
        backgroundColor: "#0f172a",
        color: "white",
        padding: "15px 30px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <h2>Community Response Network</h2>

      <div>
        <button>Resources</button>
        <button style={{ marginLeft: "10px" }}>
          Alerts
        </button>
        <button style={{ marginLeft: "10px" }}>
          Login
        </button>
      </div>
    </nav>
  );
}