/**
 * Environment variable type declarations
 *
 * This file provides type-safe access to environment variables via Bun.env
 * Add new environment variables here to get autocompletion and type checking.
 */

declare module "bun" {
  interface Env {
    // Server
    PORT?: string;
    NODE_ENV?: string;

    // Database
    DATABASE_URL: string;

    // OpenAI
    OPENAI_API_KEY: string;

    // WhatsApp / Meta
    WHATSAPP_VERIFY_TOKEN: string;
    WHATSAPP_ACCESS_TOKEN: string;
    WHATSAPP_PHONE_NUMBER_ID: string;
    META_APP_SECRET?: string;
  }
}
