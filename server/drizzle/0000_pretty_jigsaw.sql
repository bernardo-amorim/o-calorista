CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'button', 'reaction', 'unknown');--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"message_type" "message_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "food" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"fatsecret_id" varchar(500) NOT NULL,
	"calories_per_100g" real,
	"protein_per_100g" real,
	"carbs_per_100g" real,
	"fat_per_100g" real,
	"fiber_per_100g" real,
	"sodium_per_100g" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"serving_size" varchar(100) NOT NULL,
	"calories" real,
	"protein" real,
	"carbs" real,
	"fat" real,
	"fiber" real,
	"sodium" real,
	"grams_amount" real
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_id" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal" ADD CONSTRAINT "meal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_item" ADD CONSTRAINT "meal_item_meal_id_meal_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_item" ADD CONSTRAINT "meal_item_food_id_food_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."food"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_user_id_idx" ON "chat" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_created_at_idx" ON "chat" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_message_chat_id_idx" ON "chat_message" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_message_created_at_idx" ON "chat_message" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "food_fatsecret_id_idx" ON "food" USING btree ("fatsecret_id");--> statement-breakpoint
CREATE INDEX "food_name_idx" ON "food" USING btree ("name");--> statement-breakpoint
CREATE INDEX "meal_user_id_idx" ON "meal" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meal_created_at_idx" ON "meal" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meal_item_meal_id_idx" ON "meal_item" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meal_item_food_id_idx" ON "meal_item" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_whatsapp_id_idx" ON "user" USING btree ("whatsapp_id");