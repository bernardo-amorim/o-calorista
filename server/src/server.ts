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
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { sendWhatsAppMessage } from "./send-message";
import { getAggregateNutritionalValues } from "./fatsecret";
import { db, user, chat, chatMessage, food, meal, mealItem, type ChatMessage, type User, type Chat } from "./db";
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

Você tem duas ferramentas disponíveis:

1. "analyze_meal" - Use quando o usuário descrever uma refeição ou alimentos para registrar e analisar as informações nutricionais.

2. "lookup_meal_history" - Use quando o usuário quiser consultar refeições passadas, como:
   - "O que eu comi hoje?"
   - "Quantas calorias consumi ontem?"
   - "Quais foram minhas refeições da semana?"
   - "Qual foi minha refeição mais calórica?"

Seja conversacional, amigável, e use emojis ocasionalmente. Responda sempre em português brasileiro.

Se o usuário perguntar algo que não seja relacionado a nutrição/alimentação, você pode responder brevemente mas sempre tente trazer a conversa de volta para ajudá-lo com suas metas nutricionais.

Dicas importantes:
- Sempre pergunte sobre porções se o usuário não especificar
- Ofereça dicas nutricionais quando relevante
- Seja encorajador sobre escolhas alimentares saudáveis
- Não julgue escolhas menos saudáveis, apenas informe
- Quando mostrar histórico, formate de forma clara e organizada`;

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
 * Tool definition for meal history lookup
 */
const LOOKUP_MEAL_HISTORY_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "lookup_meal_history",
    description: "Consulta o histórico de refeições do usuário. Use para responder perguntas sobre refeições passadas, calorias consumidas, rankings, etc.",
    parameters: {
      type: "object",
      properties: {
        query_type: {
          type: "string",
          enum: ["list_meals", "daily_summary", "period_summary", "top_meals"],
          description: "Tipo de consulta: 'list_meals' para listar refeições, 'daily_summary' para resumo de um dia, 'period_summary' para resumo de um período, 'top_meals' para ranking de refeições",
        },
        start_date: {
          type: "string",
          description: "Data de início no formato YYYY-MM-DD. Use a data de hoje se o usuário perguntar sobre 'hoje'.",
        },
        end_date: {
          type: "string",
          description: "Data de fim no formato YYYY-MM-DD. Mesmo que start_date para consultas de um único dia.",
        },
        limit: {
          type: "number",
          description: "Número máximo de resultados para retornar (para rankings). Padrão: 5",
        },
        sort_by: {
          type: "string",
          enum: ["calories", "protein", "carbs", "fat", "date"],
          description: "Campo para ordenar os resultados. Padrão: 'date' para listagens, 'calories' para rankings.",
        },
        sort_order: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Ordem de classificação. 'desc' para mais recentes/maiores primeiro.",
        },
      },
      required: ["query_type", "start_date", "end_date"],
    },
  },
};

const TOOLS: ChatCompletionTool[] = [ANALYZE_MEAL_TOOL, LOOKUP_MEAL_HISTORY_TOOL];

// ============================================================================
// User & Chat Management
// ============================================================================

/**
 * Gets or creates a user by WhatsApp ID
 */
async function getOrCreateUser(whatsappId: string): Promise<User> {
  // Try to find existing user
  const existingUser = await db
    .select()
    .from(user)
    .where(eq(user.whatsappId, whatsappId))
    .limit(1);

  if (existingUser.length > 0) {
    return existingUser[0];
  }

  // Create new user
  const [newUser] = await db
    .insert(user)
    .values({ whatsappId })
    .returning();

  console.log(`👤 Created new user for WhatsApp ID: ${whatsappId}`);
  return newUser;
}

/**
 * Gets or creates a chat for a user
 * For now, we use a single chat per user (can be extended later for multiple conversations)
 */
async function getOrCreateChat(userId: string): Promise<Chat> {
  // Get the most recent chat for this user
  const existingChat = await db
    .select()
    .from(chat)
    .where(eq(chat.userId, userId))
    .orderBy(desc(chat.createdAt))
    .limit(1);

  if (existingChat.length > 0) {
    return existingChat[0];
  }

  // Create new chat
  const [newChat] = await db
    .insert(chat)
    .values({ userId })
    .returning();

  console.log(`💬 Created new chat for user: ${userId}`);
  return newChat;
}

/**
 * Fetches the last N messages for a chat from the database
 */
async function getConversationHistory(chatId: string, limit: number = 100): Promise<ChatMessage[]> {
  const messages = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.chatId, chatId))
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
 * Saves an inbound message to the database
 */
async function saveInboundMessage(chatId: string, message: WhatsAppMessage): Promise<ChatMessage> {
  const [savedMessage] = await db.insert(chatMessage).values({
    chatId,
    direction: "inbound",
    messageType: message.type as "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts" | "interactive" | "button" | "reaction" | "unknown",
    content: message.text?.body || null,
    metadata: message as unknown as Record<string, unknown>,
  }).returning();

  return savedMessage;
}

/**
 * Saves an outbound message to the database
 */
export async function saveOutboundMessage(chatId: string, content: string): Promise<ChatMessage> {
  const [savedMessage] = await db.insert(chatMessage).values({
    chatId,
    direction: "outbound",
    messageType: "text",
    content,
  }).returning();

  return savedMessage;
}

// ============================================================================
// Meal Analysis & Storage
// ============================================================================

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
 * Upserts a food item in the database
 */
async function upsertFood(
  name: string,
  fatsecretId: string,
  nutritionalValuesPer100g: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sodium: number;
  }
): Promise<string> {
  // Try to find existing food
  const existingFood = await db
    .select()
    .from(food)
    .where(eq(food.fatsecretId, fatsecretId))
    .limit(1);

  if (existingFood.length > 0) {
    return existingFood[0].id;
  }

  // Create new food
  const [newFood] = await db
    .insert(food)
    .values({
      name,
      fatsecretId,
      caloriesPer100g: nutritionalValuesPer100g.calories,
      proteinPer100g: nutritionalValuesPer100g.protein,
      carbsPer100g: nutritionalValuesPer100g.carbs,
      fatPer100g: nutritionalValuesPer100g.fat,
      fiberPer100g: nutritionalValuesPer100g.fiber,
      sodiumPer100g: nutritionalValuesPer100g.sodium,
    })
    .returning();

  console.log(`🍎 Created new food: ${name}`);
  return newFood.id;
}

/**
 * Saves a meal and its items to the database
 */
async function saveMeal(
  userId: string,
  nutritionalResult: AggregateNutritionalResponse
): Promise<void> {
  // Create the meal
  const [newMeal] = await db
    .insert(meal)
    .values({ userId })
    .returning();

  console.log(`🍽️ Created new meal: ${newMeal.id}`);

  // Process each item
  for (const item of nutritionalResult.items) {
    // Extract nutritional values per 100g from the item
    // The item has values for the serving, so we need to reverse-calculate per 100g
    const gramsAmount = item.gramsAmount || 100;
    const multiplier = gramsAmount / 100;

    const caloriesPer100g = multiplier > 0 ? item.nutritionalValues.energy.kcal / multiplier : 0;
    const proteinPer100g = multiplier > 0 ? item.nutritionalValues.protein / multiplier : 0;
    const carbsPer100g = multiplier > 0 ? item.nutritionalValues.carbohydrates / multiplier : 0;
    const fatPer100g = multiplier > 0 ? item.nutritionalValues.fat.total / multiplier : 0;
    const fiberPer100g = multiplier > 0 ? item.nutritionalValues.fiber / multiplier : 0;
    const sodiumPer100g = multiplier > 0 ? item.nutritionalValues.sodium / multiplier : 0;

    // Upsert the food item
    const foodId = await upsertFood(
      item.selectedFood,
      item.sourceUrl || item.selectedFood, // Use URL if available, otherwise name
      {
        calories: caloriesPer100g,
        protein: proteinPer100g,
        carbs: carbsPer100g,
        fat: fatPer100g,
        fiber: fiberPer100g,
        sodium: sodiumPer100g,
      }
    );

    // Create the meal item
    await db.insert(mealItem).values({
      mealId: newMeal.id,
      foodId,
      servingSize: item.serving || "1 porção",
      calories: item.nutritionalValues.energy.kcal,
      protein: item.nutritionalValues.protein,
      carbs: item.nutritionalValues.carbohydrates,
      fat: item.nutritionalValues.fat.total,
      fiber: item.nutritionalValues.fiber,
      sodium: item.nutritionalValues.sodium,
      gramsAmount,
    });
  }

  console.log(`✅ Saved ${nutritionalResult.items.length} meal items`);
}

/**
 * Executes the analyze_meal tool
 */
async function executeAnalyzeMealTool(userId: string, mealDescription: string): Promise<string> {
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

  // Save the meal to the database
  try {
    await saveMeal(userId, nutritionalResult);
  } catch (error) {
    console.error("⚠️ Failed to save meal to database:", error);
    // Continue anyway - we still want to return the nutritional info
  }

  // Return as a formatted string for the assistant to use
  return formatNutritionalResponse(nutritionalResult);
}

// ============================================================================
// Meal History Lookup
// ============================================================================

interface MealHistoryQuery {
  query_type: "list_meals" | "daily_summary" | "period_summary" | "top_meals";
  start_date: string;
  end_date: string;
  limit?: number;
  sort_by?: "calories" | "protein" | "carbs" | "fat" | "date";
  sort_order?: "asc" | "desc";
}

interface MealWithItems {
  id: string;
  createdAt: Date;
  items: Array<{
    foodName: string;
    servingSize: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    gramsAmount: number | null;
  }>;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
}

/**
 * Fetches meals with their items for a user within a date range
 */
async function fetchMealsWithItems(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<MealWithItems[]> {
  // Fetch meals in the date range
  const meals = await db
    .select()
    .from(meal)
    .where(
      and(
        eq(meal.userId, userId),
        gte(meal.createdAt, startDate),
        lte(meal.createdAt, endDate)
      )
    )
    .orderBy(desc(meal.createdAt));

  // Fetch items for each meal
  const mealsWithItems: MealWithItems[] = [];

  for (const m of meals) {
    const items = await db
      .select({
        foodName: food.name,
        servingSize: mealItem.servingSize,
        calories: mealItem.calories,
        protein: mealItem.protein,
        carbs: mealItem.carbs,
        fat: mealItem.fat,
        fiber: mealItem.fiber,
        gramsAmount: mealItem.gramsAmount,
      })
      .from(mealItem)
      .innerJoin(food, eq(mealItem.foodId, food.id))
      .where(eq(mealItem.mealId, m.id));

    const totalCalories = items.reduce((sum, item) => sum + (item.calories || 0), 0);
    const totalProtein = items.reduce((sum, item) => sum + (item.protein || 0), 0);
    const totalCarbs = items.reduce((sum, item) => sum + (item.carbs || 0), 0);
    const totalFat = items.reduce((sum, item) => sum + (item.fat || 0), 0);

    mealsWithItems.push({
      id: m.id,
      createdAt: m.createdAt,
      items,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
    });
  }

  return mealsWithItems;
}

/**
 * Formats a date in Brazilian Portuguese
 */
function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formats meal list response
 */
function formatMealListResponse(meals: MealWithItems[]): string {
  if (meals.length === 0) {
    return "Não encontrei nenhuma refeição registrada nesse período.";
  }

  const lines: string[] = [];
  lines.push(`📋 *${meals.length} refeição(ões) encontrada(s):*\n`);

  for (const m of meals) {
    lines.push(`🕐 *${formatDateBR(m.createdAt)}*`);
    for (const item of m.items) {
      lines.push(`   • ${item.foodName} (${item.servingSize}) - ${item.calories?.toFixed(0) || 0} kcal`);
    }
    lines.push(`   📊 Total: *${m.totalCalories.toFixed(0)} kcal* | P: ${m.totalProtein.toFixed(0)}g | C: ${m.totalCarbs.toFixed(0)}g | G: ${m.totalFat.toFixed(0)}g`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats daily/period summary response
 */
function formatSummaryResponse(meals: MealWithItems[], startDate: Date, endDate: Date): string {
  if (meals.length === 0) {
    return "Não encontrei nenhuma refeição registrada nesse período.";
  }

  const totalCalories = meals.reduce((sum, m) => sum + m.totalCalories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.totalProtein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.totalCarbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.totalFat, 0);

  const isSameDay = startDate.toDateString() === endDate.toDateString();
  const periodLabel = isSameDay
    ? `📅 *Resumo de ${startDate.toLocaleDateString("pt-BR")}*`
    : `📅 *Resumo de ${startDate.toLocaleDateString("pt-BR")} a ${endDate.toLocaleDateString("pt-BR")}*`;

  const lines: string[] = [];
  lines.push(periodLabel);
  lines.push("");
  lines.push(`🍽️ Refeições: *${meals.length}*`);
  lines.push("");
  lines.push("📊 *TOTAIS:*");
  lines.push(`⚡ Energia: *${totalCalories.toFixed(0)} kcal*`);
  lines.push(`🥩 Proteínas: ${totalProtein.toFixed(0)}g`);
  lines.push(`🍞 Carboidratos: ${totalCarbs.toFixed(0)}g`);
  lines.push(`🧈 Gorduras: ${totalFat.toFixed(0)}g`);

  if (meals.length > 1) {
    lines.push("");
    lines.push(`📈 Média por refeição: ${(totalCalories / meals.length).toFixed(0)} kcal`);
  }

  return lines.join("\n");
}

/**
 * Formats top meals response
 */
function formatTopMealsResponse(
  meals: MealWithItems[],
  sortBy: string,
  limit: number,
  sortOrder: string
): string {
  if (meals.length === 0) {
    return "Não encontrei nenhuma refeição registrada nesse período.";
  }

  // Sort meals
  const sortedMeals = [...meals].sort((a, b) => {
    let aVal: number, bVal: number;
    switch (sortBy) {
      case "protein":
        aVal = a.totalProtein;
        bVal = b.totalProtein;
        break;
      case "carbs":
        aVal = a.totalCarbs;
        bVal = b.totalCarbs;
        break;
      case "fat":
        aVal = a.totalFat;
        bVal = b.totalFat;
        break;
      case "date":
        aVal = a.createdAt.getTime();
        bVal = b.createdAt.getTime();
        break;
      default: // calories
        aVal = a.totalCalories;
        bVal = b.totalCalories;
    }
    return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
  });

  const topMeals = sortedMeals.slice(0, limit);

  const sortLabels: Record<string, string> = {
    calories: "calóricas",
    protein: "proteicas",
    carbs: "ricas em carboidratos",
    fat: "gordurosas",
    date: "recentes",
  };

  const lines: string[] = [];
  lines.push(`🏆 *Top ${topMeals.length} refeições mais ${sortLabels[sortBy] || sortBy}:*\n`);

  topMeals.forEach((m, index) => {
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    lines.push(`${medal} *${formatDateBR(m.createdAt)}*`);
    for (const item of m.items) {
      lines.push(`   • ${item.foodName} (${item.servingSize})`);
    }
    lines.push(`   📊 *${m.totalCalories.toFixed(0)} kcal* | P: ${m.totalProtein.toFixed(0)}g | C: ${m.totalCarbs.toFixed(0)}g | G: ${m.totalFat.toFixed(0)}g`);
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Executes the lookup_meal_history tool
 */
async function executeLookupMealHistoryTool(userId: string, query: MealHistoryQuery): Promise<string> {
  console.log(`📜 Looking up meal history:`, query);

  // Parse dates
  const startDate = new Date(query.start_date);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(query.end_date);
  endDate.setHours(23, 59, 59, 999);

  // Fetch meals
  const meals = await fetchMealsWithItems(userId, startDate, endDate);

  console.log(`📊 Found ${meals.length} meals in date range`);

  // Format response based on query type
  switch (query.query_type) {
    case "list_meals":
      return formatMealListResponse(meals);

    case "daily_summary":
    case "period_summary":
      return formatSummaryResponse(meals, startDate, endDate);

    case "top_meals":
      return formatTopMealsResponse(
        meals,
        query.sort_by || "calories",
        query.limit || 5,
        query.sort_order || "desc"
      );

    default:
      return formatMealListResponse(meals);
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Processes incoming WhatsApp messages using conversational AI
 */
async function processIncomingMessage(message: WhatsAppMessage): Promise<void> {
  const whatsappId = message.from;

  // Get or create user and chat
  let dbUser: User;
  let dbChat: Chat;

  try {
    dbUser = await getOrCreateUser(whatsappId);
    dbChat = await getOrCreateChat(dbUser.id);
  } catch (error) {
    console.error("⚠️ Failed to get/create user or chat:", error);
    return;
  }

  // Save the inbound message
  try {
    await saveInboundMessage(dbChat.id, message);
  } catch (error) {
    console.error("⚠️ Failed to save inbound message:", error);
    // Continue processing even if save fails
  }

  // Only respond to allowed phone numbers
  if (!ALLOWED_PHONE_NUMBERS.includes(whatsappId)) {
    console.log(`⏭️  Ignoring message from non-allowed number: ${whatsappId}`);
    return;
  }

  // Only process text messages
  if (message.type !== "text" || !message.text?.body) {
    console.log(`⏭️  Ignoring non-text message from ${whatsappId}`);
    return;
  }

  const messageText = message.text.body;
  console.log(`💬 Text message from ${whatsappId}: "${messageText}"`);

  try {
    // Fetch conversation history
    const history = await getConversationHistory(dbChat.id, 100);
    const openaiMessages = convertToOpenAIMessages(history);

    console.log(`📚 Loaded ${openaiMessages.length} messages from history`);

    // Get current date for context (helps OpenAI determine "today", "yesterday", etc.)
    const currentDate = new Date().toISOString().split("T")[0];
    const messagesWithDate: ChatCompletionMessageParam[] = [
      { 
        role: "system", 
        content: `${SYSTEM_PROMPT}\n\nData atual: ${currentDate}` 
      },
      ...openaiMessages,
      { role: "user", content: messageText },
    ];

    // Call OpenAI with tools
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesWithDate,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
    });

    let assistantMessage = response.choices[0]?.message;

    // Handle tool calls
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Tool calls requested: ${assistantMessage.tool_calls.length}`);

      // Add assistant's message with tool calls to the conversation
      messagesWithDate.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        let toolResult: string;

        if (toolCall.function.name === "analyze_meal") {
          toolResult = await executeAnalyzeMealTool(dbUser.id, args.meal_description);
        } else if (toolCall.function.name === "lookup_meal_history") {
          toolResult = await executeLookupMealHistoryTool(dbUser.id, args as MealHistoryQuery);
        } else {
          toolResult = "Ferramenta desconhecida.";
        }

        // Add tool result to messages
        messagesWithDate.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      // Get the next response from OpenAI
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messagesWithDate,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.7,
      });

      assistantMessage = response.choices[0]?.message;
    }

    // Send the final response to WhatsApp and save to DB
    const finalResponse = assistantMessage?.content || "Desculpe, não consegui processar sua mensagem.";

    // Save outbound message
    try {
      await saveOutboundMessage(dbChat.id, finalResponse);
    } catch (error) {
      console.error("⚠️ Failed to save outbound message:", error);
    }

    await sendWhatsAppMessage(whatsappId, finalResponse);

    console.log(`✅ Sent response to ${whatsappId}`);
  } catch (error) {
    console.error(`❌ Error processing message for ${whatsappId}:`, error);
    await sendWhatsAppMessage(
      whatsappId,
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
