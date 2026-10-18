// Text the triage bot from your terminal, no Twilio or server needed.
//   npm run chat
// Type messages as the resident; "/tickets" prints the stored tickets.
// Also accepts piped input, one message per line: npm run chat < scenario.txt
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import * as readline from "node:readline";

async function main() {
  const { handleMessage } = await import("../lib/engine");
  const { listTickets } = await import("../lib/store");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
  // Text as a different "phone" with CHAT_FROM=+15555550142 npm run chat
  const from = process.env.CHAT_FROM ?? "+15555550100";
  console.log("Texting as", from, "(Ctrl+C to quit)\n");
  // Piped input closes readline early, so only show the prompt interactively.
  const prompt = () => process.stdin.isTTY && rl.prompt();
  prompt();

  for await (const body of rl) {
    if (!process.stdin.isTTY) console.log(`you> ${body}`);
    if (body.trim() === "/tickets") {
      console.dir(await listTickets(), { depth: null });
      prompt();
      continue;
    }
    const started = Date.now();
    const { reply, ticketId, emergency } = await handleMessage({ channel: "sms", from, body });
    const meta = [`${Date.now() - started}ms`, ticketId && `ticket #${ticketId}`, emergency && "EMERGENCY"];
    console.log(`bot> ${reply}\n     (${meta.filter(Boolean).join(", ")})\n`);
    prompt();
  }
}

main();
