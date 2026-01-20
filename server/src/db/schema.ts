/**
 * Database Schema for O Calorista
 *
 * Defines all tables using Drizzle ORM
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  jsonb,
  index,
  real,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// Enums
// ============================================================================

/**
 * Message direction enum
 */
export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound", // User -> Bot
  "outbound", // Bot -> User
]);

/**
 * Message type enum (WhatsApp message types)
 */
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
  "unknown",
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * User table
 * Stores users who have interacted with O Calorista
 */
export const user = pgTable(
  "user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    whatsappId: varchar("whatsapp_id", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_whatsapp_id_idx").on(table.whatsappId),
  ]
);

/**
 * Chat table
 * Stores chat sessions with users
 */
export const chat = pgTable(
  "chat",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chat_user_id_idx").on(table.userId),
    index("chat_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Chat message table
 * Stores messages exchanged in chats
 */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chat.id),
    direction: messageDirectionEnum("direction").notNull(),
    messageType: messageTypeEnum("message_type").notNull().default("text"),
    content: text("content"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("chat_message_chat_id_idx").on(table.chatId),
    index("chat_message_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Food table
 * Stores food items from FatSecret
 */
export const food = pgTable(
  "food",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    fatsecretId: varchar("fatsecret_id", { length: 500 }).notNull(), // URL path from fatsecret
    
    // Nutritional values per 100g (cached from FatSecret)
    caloriesPer100g: real("calories_per_100g"),
    proteinPer100g: real("protein_per_100g"),
    carbsPer100g: real("carbs_per_100g"),
    fatPer100g: real("fat_per_100g"),
    fiberPer100g: real("fiber_per_100g"),
    sodiumPer100g: real("sodium_per_100g"),
    
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("food_fatsecret_id_idx").on(table.fatsecretId),
    index("food_name_idx").on(table.name),
  ]
);

/**
 * Meal table
 * Stores meals eaten by users
 */
export const meal = pgTable(
  "meal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("meal_user_id_idx").on(table.userId),
    index("meal_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Meal item table
 * Stores individual items in a meal
 */
export const mealItem = pgTable(
  "meal_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meal.id),
    foodId: uuid("food_id")
      .notNull()
      .references(() => food.id),
    servingSize: varchar("serving_size", { length: 100 }).notNull(), // e.g., "100g", "1 colher de sopa"
    
    // Calculated nutritional values for this serving (snapshot at time of recording)
    calories: real("calories"),
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    fiber: real("fiber"),
    sodium: real("sodium"),
    gramsAmount: real("grams_amount"), // Serving size converted to grams
  },
  (table) => [
    index("meal_item_meal_id_idx").on(table.mealId),
    index("meal_item_food_id_idx").on(table.foodId),
  ]
);

// ============================================================================
// Type Exports
// ============================================================================

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type Chat = typeof chat.$inferSelect;
export type NewChat = typeof chat.$inferInsert;

export type ChatMessage = typeof chatMessage.$inferSelect;
export type NewChatMessage = typeof chatMessage.$inferInsert;

export type Food = typeof food.$inferSelect;
export type NewFood = typeof food.$inferInsert;

export type Meal = typeof meal.$inferSelect;
export type NewMeal = typeof meal.$inferInsert;

export type MealItem = typeof mealItem.$inferSelect;
export type NewMealItem = typeof mealItem.$inferInsert;
