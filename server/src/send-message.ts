/**
 * Send a WhatsApp message using the Cloud API
 *
 * Usage: bun run send-message <phone_number> <message>
 * Example: bun run send-message '5519992932912' 'hello, love'
 *
 * Required environment variables (from .env):
 * - WHATSAPP_PHONE_NUMBER_ID: Your WhatsApp Business phone number ID
 * - WHATSAPP_ACCESS_TOKEN: Your access token from Meta Developer Portal
 */

import { db, chatMessage } from "./db";

const WHATSAPP_API_VERSION = "v22.0";
// Environment variables (typed in env.d.ts)
const WHATSAPP_PHONE_NUMBER_ID = Bun.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = Bun.env.WHATSAPP_ACCESS_TOKEN;

interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

interface WhatsAppErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

/**
 * Sends a text message via WhatsApp Cloud API and saves it to the database
 */
async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<WhatsAppMessageResponse> {
  if (!WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID environment variable is not set");
  }
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN environment variable is not set");
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorData = data as WhatsAppErrorResponse;
    throw new Error(
      `WhatsApp API error: ${errorData.error?.message || "Unknown error"} (code: ${errorData.error?.code})`
    );
  }

  const result = data as WhatsAppMessageResponse;

  // Save outbound message to database
  try {
    await db.insert(chatMessage).values({
      whatsappMessageId: result.messages[0]?.id,
      phoneNumber: to,
      direction: "outbound",
      messageType: "text",
      content: message,
    });
  } catch (error) {
    console.error("⚠️ Failed to save outbound message to database:", error);
    // Don't throw - message was sent successfully, just logging failed
  }

  return result;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: bun run send-message <phone_number> <message>");
    console.error("Example: bun run send-message '5519992932912' 'hello, love'");
    process.exit(1);
  }

  const [phoneNumber, ...messageParts] = args;
  const message = messageParts.join(" ");

  console.log(`📤 Sending message to ${phoneNumber}...`);

  try {
    const result = await sendWhatsAppMessage(phoneNumber, message);
    console.log(`✅ Message sent successfully!`);
    console.log(`   Message ID: ${result.messages[0]?.id}`);
    console.log(`   WhatsApp ID: ${result.contacts[0]?.wa_id}`);
  } catch (error) {
    console.error(`❌ Failed to send message:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.main) {
  main();
}

// Export for use in other modules
export { sendWhatsAppMessage };
