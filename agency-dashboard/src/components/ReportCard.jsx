export default function ReportCard({
  report,
  onResolve,
}) {
  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #ddd",
        borderRadius: "10px",
        padding: "15px",
        marginBottom: "15px",
      }}
    >
      <img
        src={report.photo}
        alt={report.title}
        width="100%"
      />

      <h3>{report.title}</h3>

      <p>
        📍 {report.location}
      </p>

      <p>
        🌎 GPS: {report.gps}
      </p>

      <p>
        Status: {report.status}
      </p>

      <p>
        Organization:
        {report.organization}
      </p>

      <button
        onClick={() =>
          onResolve(report.id)
        }
      >
        Resolve
      </button>
    </div>
  );
}
