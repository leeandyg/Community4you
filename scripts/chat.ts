// Text the triage bot from your terminal, no Twilio or server needed.
//   npm run chat
// Type messages as the resident; "/tickets" prints the stored tickets.
// Also accepts piped input, one message per line: npm run chat < scenario.txt
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// Never send real texts from local testing (e.g. "Others have reported this too" to fake numbers).
process.env.SMS_DRY_RUN ??= "1";

import * as readline from "node:readline";

async function main() {
  const { handleMessage } = await import("../lib/engine");
  const { listTickets } = await import("../lib/store");
  const { analyzeTicket } = await import("../lib/analyze");
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
    const { reply, ticketId, emergency, analyzeTicketId } = await handleMessage({ channel: "sms", from, body });
    const meta = [`${Date.now() - started}ms`, ticketId && `ticket #${ticketId}`, emergency && "EMERGENCY"];
    console.log(`bot> ${reply}\n     (${meta.filter(Boolean).join(", ")})`);
    if (analyzeTicketId) {
      const outcome = await analyzeTicket(analyzeTicketId);
      if (outcome) {
        const i = outcome.incident;
        console.log(
          `     [analysis] ${outcome.joinedExisting ? "joined" : "incident"} #${i.id} "${i.title}" ` +
            `${i.priority}/${i.priorityScore}, ${i.reportCount} report(s): ${outcome.reason}`,
        );
      }
    }
    console.log();
    prompt();
  }
}

main();
