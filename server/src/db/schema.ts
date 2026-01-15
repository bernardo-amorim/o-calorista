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
} from "drizzle-orm/pg-core";

/**
 * Message direction enum
 */
export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",  // User -> Bot
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

/**
 * Chat message table
 * Stores all messages exchanged between the WhatsApp bot and users
 */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // WhatsApp identifiers
    whatsappMessageId: varchar("whatsapp_message_id", { length: 255 }),
    phoneNumber: varchar("phone_number", { length: 20 }).notNull(),

    // Message details
    direction: messageDirectionEnum("direction").notNull(),
    messageType: messageTypeEnum("message_type").notNull().default("text"),
    content: text("content"),

    // Metadata (raw WhatsApp payload, errors, etc.)
    metadata: jsonb("metadata"),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    // Index for querying messages by phone number
    index("chat_message_phone_number_idx").on(table.phoneNumber),
    // Index for querying by WhatsApp message ID (for deduplication)
    index("chat_message_whatsapp_message_id_idx").on(table.whatsappMessageId),
    // Index for querying recent messages
    index("chat_message_created_at_idx").on(table.createdAt),
  ]
);

/**
 * Type exports for use in application code
 */
export type ChatMessage = typeof chatMessage.$inferSelect;
export type NewChatMessage = typeof chatMessage.$inferInsert;
