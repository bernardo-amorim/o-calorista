#!/usr/bin/env bun
/**
 * Sync .env file to AWS Secrets Manager
 *
 * Usage:
 *   bun run scripts/sync-secrets.ts [environment]
 *
 * Examples:
 *   bun run scripts/sync-secrets.ts              # defaults to 'production'
 *   bun run scripts/sync-secrets.ts staging      # use 'staging' environment
 *
 * This script will:
 *   1. Read the .env file
 *   2. For each key-value pair, create or update a secret in AWS Secrets Manager
 *   3. Secret names follow the pattern: ocalorista/{environment}/{key-name}
 *
 * Prerequisites:
 *   - AWS CLI configured with appropriate credentials
 *   - Permissions to create/update secrets in Secrets Manager
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_NAME = "ocalorista";

// Keys that should be synced to Secrets Manager
const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET",
];

interface SecretResult {
  key: string;
  secretName: string;
  status: "created" | "updated" | "skipped" | "error";
  message?: string;
}

/**
 * Parse .env file and return key-value pairs
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse KEY=VALUE
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Convert KEY_NAME to key-name for secret naming
 */
function toSecretName(key: string): string {
  return key.toLowerCase().replace(/_/g, "-");
}

/**
 * Check if a secret exists in AWS Secrets Manager
 */
async function secretExists(secretName: string): Promise<boolean> {
  const proc = Bun.spawn(
    ["aws", "secretsmanager", "describe-secret", "--secret-id", secretName],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;
  return proc.exitCode === 0;
}

/**
 * Create a new secret in AWS Secrets Manager
 */
async function createSecret(secretName: string, value: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "aws", "secretsmanager", "create-secret",
      "--name", secretName,
      "--secret-string", value,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create secret: ${stderr}`);
  }
}

/**
 * Update an existing secret in AWS Secrets Manager
 */
async function updateSecret(secretName: string, value: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "aws", "secretsmanager", "put-secret-value",
      "--secret-id", secretName,
      "--secret-string", value,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to update secret: ${stderr}`);
  }
}

/**
 * Sync a single secret to AWS Secrets Manager
 */
async function syncSecret(
  key: string,
  value: string,
  environment: string
): Promise<SecretResult> {
  const secretName = `${PROJECT_NAME}/${environment}/${toSecretName(key)}`;

  if (!value) {
    return {
      key,
      secretName,
      status: "skipped",
      message: "Empty value",
    };
  }

  try {
    const exists = await secretExists(secretName);

    if (exists) {
      await updateSecret(secretName, value);
      return { key, secretName, status: "updated" };
    } else {
      await createSecret(secretName, value);
      return { key, secretName, status: "created" };
    }
  } catch (error) {
    return {
      key,
      secretName,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate Terraform tfvars snippet for the secrets
 */
function generateTerraformSnippet(results: SecretResult[], region: string): string {
  const successfulSecrets = results.filter(
    (r) => r.status === "created" || r.status === "updated"
  );

  if (successfulSecrets.length === 0) {
    return "";
  }

  const lines = [
    "# Add this to your terraform.tfvars:",
    "secrets = [",
  ];

  for (const result of successfulSecrets) {
    lines.push(`  {`);
    lines.push(`    name       = "${result.key}"`);
    lines.push(`    value_from = "arn:aws:secretsmanager:${region}:YOUR_ACCOUNT_ID:secret:${result.secretName}"`);
    lines.push(`  },`);
  }

  lines.push("]");
  return lines.join("\n");
}

async function main() {
  const environment = process.argv[2] || "production";
  const envFile = join(import.meta.dir, "..", ".env");

  console.log(`🔐 Syncing secrets to AWS Secrets Manager`);
  console.log(`   Environment: ${environment}`);
  console.log(`   Source file: ${envFile}`);
  console.log();

  // Parse .env file
  let env: Record<string, string>;
  try {
    env = parseEnvFile(envFile);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Filter to only the keys we want to sync
  const keysToSync = SECRET_KEYS.filter((key) => key in env);

  if (keysToSync.length === 0) {
    console.log("⚠️  No secrets found to sync. Expected keys:");
    for (const key of SECRET_KEYS) {
      console.log(`   - ${key}`);
    }
    process.exit(0);
  }

  console.log(`📋 Secrets to sync: ${keysToSync.length}`);
  console.log();

  // Sync each secret
  const results: SecretResult[] = [];
  for (const key of keysToSync) {
    process.stdout.write(`   ${key}... `);
    const result = await syncSecret(key, env[key], environment);
    results.push(result);

    switch (result.status) {
      case "created":
        console.log("✅ created");
        break;
      case "updated":
        console.log("🔄 updated");
        break;
      case "skipped":
        console.log(`⏭️  skipped (${result.message})`);
        break;
      case "error":
        console.log(`❌ error: ${result.message}`);
        break;
    }
  }

  console.log();

  // Summary
  const created = results.filter((r) => r.status === "created").length;
  const updated = results.filter((r) => r.status === "updated").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log("📊 Summary:");
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors:  ${errors}`);

  // Generate Terraform snippet
  if (created + updated > 0) {
    console.log();
    console.log("─".repeat(60));
    console.log(generateTerraformSnippet(results, "us-east-1"));
  }

  process.exit(errors > 0 ? 1 : 0);
}

main();
