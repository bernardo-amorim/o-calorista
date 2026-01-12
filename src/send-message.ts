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

const WHATSAPP_API_VERSION = "v22.0";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

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
 * Sends a text message via WhatsApp Cloud API
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

  return data as WhatsAppMessageResponse;
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
