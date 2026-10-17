// Point the Android SMS gateway at our server. Re-run whenever the public URL
// changes (new ngrok session, Vercel deploy URL).
//   npm run gateway:register -- https://abc123.ngrok-free.app
import { config } from "dotenv";
config({ path: ".env.local" });

interface Webhook {
  id: string;
  url: string;
  event: string;
}

async function main() {
  const { gatewayRequest } = await import("../lib/smsgate");
  const base = process.argv[2]?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) {
    console.error("Usage: npm run gateway:register -- https://<public-host>");
    process.exit(1);
  }
  const url = `${base}/api/smsgate`;

  const existing = (await (await gatewayRequest("/webhooks")).json()) as Webhook[];
  for (const hook of existing.filter((h) => h.event === "sms:received")) {
    await gatewayRequest(`/webhooks/${hook.id}`, { method: "DELETE" });
    console.log("Removed old webhook:", hook.url);
  }

  await gatewayRequest("/webhooks", {
    method: "POST",
    body: JSON.stringify({ url, event: "sms:received" }),
  });
  console.log("Registered webhook:", url);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
