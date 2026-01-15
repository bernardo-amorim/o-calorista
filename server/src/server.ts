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
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { desc, eq } from "drizzle-orm";
import { sendWhatsAppMessage } from "./send-message";
import { getAggregateNutritionalValues } from "./fatsecret";
import { db, chatMessage, type ChatMessage } from "./db";
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
 * System prompt for O Calorista assistant
 */
const SYSTEM_PROMPT = `Você é O Calorista, um assistente nutricional brasileiro amigável e útil no WhatsApp.

Sua especialidade é ajudar usuários a entender o valor nutricional das refeições que eles consomem.

Quando o usuário descrever uma refeição ou alimentos, use a ferramenta "analyze_meal" para obter as informações nutricionais detalhadas. A ferramenta aceita uma descrição em linguagem natural da refeição.

Seja conversacional, amigável, e use emojis ocasionalmente. Responda sempre em português brasileiro.

Se o usuário perguntar algo que não seja relacionado a nutrição/alimentação, você pode responder brevemente mas sempre tente trazer a conversa de volta para ajudá-lo com suas metas nutricionais.

Dicas importantes:
- Sempre pergunte sobre porções se o usuário não especificar
- Ofereça dicas nutricionais quando relevante
- Seja encorajador sobre escolhas alimentares saudáveis
- Não julgue escolhas menos saudáveis, apenas informe`;

/**
 * Tool definition for meal analysis
 */
const ANALYZE_MEAL_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "analyze_meal",
    description: "Analisa uma refeição e retorna informações nutricionais detalhadas. Use quando o usuário descrever alimentos ou uma refeição.",
    parameters: {
      type: "object",
      properties: {
        meal_description: {
          type: "string",
          description: "Descrição da refeição em linguagem natural, incluindo os alimentos e porções. Exemplo: '2 ovos fritos, 100g de arroz branco e uma banana'",
        },
      },
      required: ["meal_description"],
    },
  },
};

/**
 * Fetches the last N messages for a phone number from the database
 */
async function getConversationHistory(phoneNumber: string, limit: number = 100): Promise<ChatMessage[]> {
  const messages = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.phoneNumber, phoneNumber))
    .orderBy(desc(chatMessage.createdAt))
    .limit(limit);
  
  // Return in chronological order (oldest first)
  return messages.reverse();
}

/**
 * Converts database messages to OpenAI chat format
 */
function convertToOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages
    .filter((msg) => msg.content) // Only include messages with content
    .map((msg): ChatCompletionMessageParam => ({
      role: msg.direction === "inbound" ? "user" : "assistant",
      content: msg.content!,
    }));
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
    // Don't throw, dude - continue processing even if save fails
  }
}

/**
 * Executes the analyze_meal tool
 */
async function executeAnalyzeMealTool(mealDescription: string): Promise<string> {
  console.log(`🔎 Analyzing meal: "${mealDescription}"`);
  
  // Parse the meal description into food items using OpenAI
  const parseResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extraia os itens alimentares e suas porções da descrição fornecida.
Retorne em português brasileiro, com nomes simples de alimentos.
Se a porção não for especificada, estime baseado no contexto.`,
      },
      {
        role: "user",
        content: mealDescription,
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
                  foodName: { type: "string" },
                  serving: { type: "string" },
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

  const parseContent = parseResponse.choices[0]?.message?.content;
  if (!parseContent) {
    return "Não consegui identificar os alimentos na descrição.";
  }

  let foodItems: FoodItem[];
  try {
    const parsed = JSON.parse(parseContent);
    foodItems = parsed.items;
  } catch {
    return "Erro ao processar os alimentos.";
  }

  if (foodItems.length === 0) {
    return "Não encontrei nenhum alimento na descrição.";
  }

  console.log(`📋 Parsed ${foodItems.length} food items:`, foodItems);

  // Get nutritional values
  const nutritionalResult = await getAggregateNutritionalValues({ items: foodItems });
  
  // Return as a formatted string for the assistant to use
  return formatNutritionalResponse(nutritionalResult);
}

/**
 * Processes incoming WhatsApp messages using conversational AI
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
    // Fetch conversation history
    const history = await getConversationHistory(senderPhone, 100);
    const openaiMessages = convertToOpenAIMessages(history);
    
    console.log(`📚 Loaded ${openaiMessages.length} messages from history`);

    // Build the messages array for OpenAI
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...openaiMessages,
      { role: "user", content: messageText },
    ];

    // Call OpenAI with tools
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: [ANALYZE_MEAL_TOOL],
      tool_choice: "auto",
      temperature: 0.7,
    });

    let assistantMessage = response.choices[0]?.message;

    // Handle tool calls
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Tool calls requested: ${assistantMessage.tool_calls.length}`);
      
      // Add assistant's message with tool calls to the conversation
      messages.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.function.name === "analyze_meal") {
          const args = JSON.parse(toolCall.function.arguments);
          const toolResult = await executeAnalyzeMealTool(args.meal_description);
          
          // Add tool result to messages
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }
      }

      // Get the next response from OpenAI
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools: [ANALYZE_MEAL_TOOL],
        tool_choice: "auto",
        temperature: 0.7,
      });

      assistantMessage = response.choices[0]?.message;
    }

    // Send the final response to WhatsApp
    const finalResponse = assistantMessage?.content || "Desculpe, não consegui processar sua mensagem.";
    await sendWhatsAppMessage(senderPhone, finalResponse);
    
    console.log(`✅ Sent response to ${senderPhone}`);
  } catch (error) {
    console.error(`❌ Error processing message for ${senderPhone}:`, error);
    await sendWhatsAppMessage(
      senderPhone,
      "❌ Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente."
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
