/**
 * O Calorista - WhatsApp Webhook Server
 *
 * Environment variables (loaded automatically from .env by Bun):
 * - WHATSAPP_VERIFY_TOKEN: Token for Meta webhook verification
 * - META_APP_SECRET: App secret for signature verification
 * - WHATSAPP_PHONE_NUMBER_ID: Phone number ID for sending messages
 * - WHATSAPP_ACCESS_TOKEN: Access token for WhatsApp API
 * - OPENAI_API_KEY: OpenAI API key for food selection
 * - PORT: Server port (default: 3000)
 *
 * Copy .env.test to .env and fill in your values to get started.
 */

import crypto from "crypto";
import OpenAI from "openai";
import { sendWhatsAppMessage } from "./send-message";
import { getAggregateNutritionalValues } from "./fatsecret";
import { db, chatMessage } from "./db";
import type { FoodItem, AggregateNutritionalResponse } from "./types";

// Environment variables (typed in env.d.ts, Bun automatically loads .env files)
const VERIFY_TOKEN = Bun.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = Bun.env.META_APP_SECRET;
const PORT = Bun.env.PORT || 3000;

// Allowed phone numbers that the bot will respond to
const ALLOWED_PHONE_NUMBERS = ["5519992932912", "5519995666244"];

// OpenAI client
const openai = new OpenAI();

/**
 * WhatsApp webhook payload types
 */
interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      messages?: WhatsAppMessage[];
      statuses?: Array<unknown>;
    };
    field: string;
  }>;
}

interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

/**
 * Verifies the X-Hub-Signature-256 header from Meta
 */
function verifySignature(rawBody: Buffer, signature: string | null): boolean {
  if (!APP_SECRET || !signature) {
    // If no secret configured, skip verification (not recommended for production)
    return true;
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Handles GET /webhook - Meta's verification handshake
 */
function handleVerification(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    return new Response(challenge, { status: 200 });
  }

  console.log("❌ Webhook verification failed");
  return new Response("Forbidden", { status: 403 });
}

/**
 * Schema for meal parsing response from OpenAI
 */
interface MealParseResponse {
  items: Array<{
    foodName: string;
    serving: string;
  }>;
}

/**
 * Uses OpenAI to parse a meal description into food items with serving sizes
 */
async function parseMealDescription(mealDescription: string): Promise<FoodItem[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assistente que ajuda a extrair itens alimentares de descrições de refeições.
Sua tarefa é identificar cada alimento mencionado e estimar a porção.
Retorne os alimentos em português brasileiro, com nomes simples que seriam encontrados em uma tabela nutricional.
Se a porção não for especificada, faça uma estimativa razoável baseada no contexto.

Exemplos de porções: "100g", "1 colher de sopa", "1 xícara", "1 filé médio", "1 prato", "2 fatias", etc.`,
      },
      {
        role: "user",
        content: `Extraia os itens alimentares e porções desta refeição:\n\n"${mealDescription}"`,
      },
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meal_items",
        strict: true,
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  foodName: {
                    type: "string",
                    description: "Nome do alimento em português",
                  },
                  serving: {
                    type: "string",
                    description: "Tamanho da porção (ex: '100g', '1 colher de sopa')",
                  },
                },
                required: ["foodName", "serving"],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return [];
  }

  try {
    const parsed: MealParseResponse = JSON.parse(content);
    return parsed.items;
  } catch {
    return [];
  }
}

/**
 * Formats the nutritional response into a WhatsApp-friendly message
 */
function formatNutritionalResponse(result: AggregateNutritionalResponse): string {
  const lines: string[] = [];
  
  lines.push("🍽️ *Análise Nutricional da Refeição*");
  lines.push("");
  
  // Individual items
  lines.push("📋 *Itens identificados:*");
  for (const item of result.items) {
    lines.push(`• ${item.selectedFood} (${item.serving}) - ${item.nutritionalValues.energy.kcal} kcal`);
  }
  
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  
  // Totals
  const t = result.totals;
  lines.push("📊 *TOTAIS:*");
  lines.push(`⚡ Energia: *${t.energy.kcal} kcal*`);
  lines.push(`🍞 Carboidratos: ${t.carbohydrates}g`);
  lines.push(`   └ Açúcar: ${t.sugar}g`);
  lines.push(`🥩 Proteínas: ${t.protein}g`);
  lines.push(`🧈 Gorduras: ${t.fat.total}g`);
  lines.push(`   ├ Saturada: ${t.fat.saturated}g`);
  lines.push(`   └ Trans: ${t.fat.trans}g`);
  lines.push(`🌾 Fibras: ${t.fiber}g`);
  lines.push(`🧂 Sódio: ${t.sodium}mg`);
  
  lines.push("");
  lines.push(`📦 Peso total: ${result.totalGrams}g`);
  
  return lines.join("\n");
}

/**
 * Saves an inbound message to the database
 */
async function saveInboundMessage(message: WhatsAppMessage): Promise<void> {
  try {
    await db.insert(chatMessage).values({
      whatsappMessageId: message.id,
      phoneNumber: message.from,
      direction: "inbound",
      messageType: message.type as "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts" | "interactive" | "button" | "reaction" | "unknown",
      content: message.text?.body || null,
      metadata: message as unknown as Record<string, unknown>,
    });
  } catch (error) {
    console.error("⚠️ Failed to save inbound message to database:", error);
    // Don't throw - continue processing even if save fails
  }
}

/**
 * Processes incoming WhatsApp messages
 */
async function processIncomingMessage(message: WhatsAppMessage): Promise<void> {
  const senderPhone = message.from;

  // Save all inbound messages to database (regardless of allowed status)
  await saveInboundMessage(message);
  
  // Only respond to allowed phone numbers
  if (!ALLOWED_PHONE_NUMBERS.includes(senderPhone)) {
    console.log(`⏭️  Ignoring message from non-allowed number: ${senderPhone}`);
    return;
  }

  // Only process text messages
  if (message.type !== "text" || !message.text?.body) {
    console.log(`⏭️  Ignoring non-text message from ${senderPhone}`);
    return;
  }

  const messageText = message.text.body;
  console.log(`💬 Text message from ${senderPhone}: "${messageText}"`);

  try {
    // Send acknowledgment
    await sendWhatsAppMessage(senderPhone, "🔍 Analisando sua refeição...");
    
    // Step 1: Parse the meal description into food items
    console.log("📝 Parsing meal description...");
    const foodItems = await parseMealDescription(messageText);
    
    if (foodItems.length === 0) {
      await sendWhatsAppMessage(senderPhone, "❌ Não consegui identificar nenhum alimento na sua mensagem. Tente descrever sua refeição novamente.");
      return;
    }
    
    console.log(`📋 Parsed ${foodItems.length} food items:`, foodItems);
    
    // Step 2: Get aggregate nutritional values
    console.log("🔎 Fetching nutritional values...");
    const nutritionalResult = await getAggregateNutritionalValues({ items: foodItems });
    
    // Step 3: Format and send the response
    const responseMessage = formatNutritionalResponse(nutritionalResult);
    await sendWhatsAppMessage(senderPhone, responseMessage);
    
    console.log(`✅ Sent nutritional analysis to ${senderPhone}`);
  } catch (error) {
    console.error(`❌ Error processing meal for ${senderPhone}:`, error);
    await sendWhatsAppMessage(
      senderPhone,
      "❌ Ocorreu um erro ao analisar sua refeição. Por favor, tente novamente."
    ).catch(() => {});
  }
}

/**
 * Handles POST /webhook - Incoming events from WhatsApp
 */
async function handleWebhook(req: Request): Promise<Response> {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("X-Hub-Signature-256");

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    console.log("❌ Invalid signature");
    return new Response("Forbidden", { status: 403 });
  }

  // Parse the webhook payload
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString());
    console.log("\n📩 Webhook received:");
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.log("⚠️ Failed to parse webhook payload:", error);
    return new Response("OK", { status: 200 });
  }

  // Process incoming messages (don't await - respond quickly to webhook)
  if (payload.object === "whatsapp_business_account") {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field === "messages" && change.value.messages) {
          for (const message of change.value.messages) {
            // Process message asynchronously to not block the webhook response
            processIncomingMessage(message).catch((error) => {
              console.error("Error processing message:", error);
            });
          }
        }
      }
    }
  }

  // Always acknowledge quickly
  return new Response("OK", { status: 200 });
}

/**
 * Main request handler
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/webhook") {
    if (req.method === "GET") {
      return handleVerification(req);
    }
    if (req.method === "POST") {
      return handleWebhook(req);
    }
  }

  // Health check endpoint
  if (url.pathname === "/" && req.method === "GET") {
    return new Response("O Calorista WhatsApp Bot is running! 🥗", { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
}

// Start the server using Bun's native HTTP server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`🚀 O Calorista server listening on http://localhost:${server.port}`);
console.log(`📱 WhatsApp webhook endpoint: http://localhost:${server.port}/webhook`);

if (!VERIFY_TOKEN) {
  console.log("⚠️  Warning: WHATSAPP_VERIFY_TOKEN not set");
}
if (!APP_SECRET) {
  console.log("⚠️  Warning: META_APP_SECRET not set (signature verification disabled)");
}
