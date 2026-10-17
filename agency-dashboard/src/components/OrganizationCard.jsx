export default function OrganizationCard({
  organization,
  onSelect,
}) {
  return (
    <div
      onClick={() =>
        onSelect(organization)
      }
      style={{
        backgroundColor: "white",
        padding: "15px",
        borderRadius: "10px",
        marginBottom: "10px",
        cursor: "pointer",
      }}
    >
      <h3>
        {organization.name}
      </h3>

      <p>
        {organization.category}
      </p>

      <p>
        Active Cases:
        {organization.activeCases}
      </p>
    </div>
  );
}