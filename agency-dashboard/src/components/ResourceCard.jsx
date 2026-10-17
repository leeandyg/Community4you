export default function ResourceCard({
  resource,
}) {
  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "15px",
        borderRadius: "10px",
        border: "1px solid #ddd",
      }}
    >
      <h3>
        {resource.name}
      </h3>

      <p>
        Type:
        {resource.type}
      </p>

      <p>
        Address:
        {resource.address}
      </p>

      <p>
        Phone:
        {resource.phone}
      </p>
    </div>
  );
}