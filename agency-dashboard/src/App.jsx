import { useState } from "react";

export default function App() {
  const [selectedOrg, setSelectedOrg] = useState(null);

  const organizations = [
    {
      id: 1,
      name: "County Relief Network",
      description:
        "Coordinates disaster response, shelter support, and food distribution.",
      activeCases: 12,
    },
    {
      id: 2,
      name: "Red Cross",
      description:
        "Provides emergency shelter and medical assistance.",
      activeCases: 8,
    },
    {
      id: 3,
      name: "Community Action Group",
      description:
        "Supports vulnerable residents and transportation needs.",
      activeCases: 5,
    },
  ];

  const [reports, setReports] = useState([
    {
      id: 101,
      title: "Flooded Road",
      location: "Main Street",
      gps: "34.1234, -118.1234",
      organization: "County Relief Network",
      priority: "HIGH",
      status: "Pending",
      photo:
        "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=400",
    },
    {
      id: 102,
      title: "Power Outage",
      location: "Oak Street",
      gps: "34.5555, -118.5555",
      organization: "Red Cross",
      priority: "MEDIUM",
      status: "Pending",
      photo:
        "https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=400",
    },
  ]);

  function updateStatus(id, newStatus) {
    setReports(
      reports.map((report) =>
        report.id === id
          ? { ...report, status: newStatus }
          : report
      )
    );
  }

  return (
    <div
      style={{
        fontFamily: "Arial",
        minHeight: "100vh",
        backgroundColor: "#f4f6f8",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#0f172a",
          color: "white",
          padding: "20px",
        }}
      >
        <h1>Community Response Network</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gap: "20px",
          padding: "20px",
        }}
      >
        {/* Organizations */}
        <div
          style={{
            background: "white",
            borderRadius: "10px",
            padding: "20px",
          }}
        >
          <h2>Organizations</h2>

          {organizations.map((org) => (
            <div
              key={org.id}
              onClick={() => setSelectedOrg(org)}
              style={{
                cursor: "pointer",
                border: "1px solid #ddd",
                padding: "10px",
                marginBottom: "10px",
                borderRadius: "8px",
              }}
            >
              <strong>{org.name}</strong>
              <p>{org.activeCases} Active Cases</p>
            </div>
          ))}
        </div>

        {/* Main Area */}
        <div>
          {/* Organization Details */}
          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "10px",
              marginBottom: "20px",
            }}
          >
            <h2>Organization Details</h2>

            {selectedOrg ? (
              <>
                <h3>{selectedOrg.name}</h3>

                <p>{selectedOrg.description}</p>

                <p>
                  Active Cases:
                  {selectedOrg.activeCases}
                </p>
              </>
            ) : (
              <p>Select an organization.</p>
            )}
          </div>

          {/* Active Cases */}
          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "10px",
            }}
          >
            <h2>Active Cases</h2>

            {reports.map((report) => (
              <div
                key={report.id}
                style={{
                  border: "1px solid #ddd",
                  marginBottom: "15px",
                  borderRadius: "8px",
                  padding: "15px",
                }}
              >
                <img
                  src={report.photo}
                  alt={report.title}
                  style={{
                    width: "200px",
                  }}
                />
                <p>
                  🌎 GPS: {report.gps}
                </p>

                <p>
                  🏢 Organization:
                  {report.organization}
                </p>

                <p>
                  ⚠ Priority:
                  {report.priority}
                </p>

                <p>
                  Status:
                  <strong> {report.status}</strong>
                </p>

                <button
                  onClick={() =>
                    updateStatus(
                      report.id,
                      "Resolved"
                    )
                  }
                >
                  Resolve
                </button>

                <button
                  onClick={() =>
                    updateStatus(
                      report.id,
                      "Under Review"
                    )
                  }
                  style={{ marginLeft: "10px" }}
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}