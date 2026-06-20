import { v } from "convex/values";
import { authComponent } from "./auth";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";

const MAX_NAME_LENGTH = 64;
const MAX_PREFIX_LENGTH = 32;
const API_KEY_PREFIX = "gx_mcp_";

type StoredApiKeyResult = {
  id: Id<"apiKeys">;
  createdAt: number;
};

type CreatedApiKeyResult = StoredApiKeyResult & {
  apiKey: string;
};

function normalizeName(name: string) {
  const trimmed = name.trim();
  return (trimmed || "MCP API key").slice(0, MAX_NAME_LENGTH);
}

function validateKeyPrefix(keyPrefix: string) {
  const normalized = keyPrefix.trim();
  if (!normalized || normalized.length > MAX_PREFIX_LENGTH) {
    throw new Error("Invalid API key prefix");
  }
  return normalized;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateApiKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${base64Url(bytes)}`;
}

function previewApiKey(apiKey: string) {
  return `${apiKey.slice(0, 16)}...${apiKey.slice(-4)}`;
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getApiKeyHashSecret() {
  const secret =
    process.env.API_KEY_HASH_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("API_KEY_HASH_SECRET or BETTER_AUTH_SECRET is not configured");
  }
  return secret;
}

async function hmacApiKey(apiKey: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getApiKeyHashSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(apiKey));
  return bytesToHex(signature);
}

export const listMyApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", user._id))
      .collect();

    return keys
      .filter((key) => !key.revokedAt)
      .map((key) => ({
        id: key._id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createMyApiKey = action({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args): Promise<CreatedApiKeyResult> => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const apiKey = generateApiKey();
    const result: StoredApiKeyResult = await ctx.runMutation(
      internal.apiKeys.insertApiKeyForUser,
      {
        userId: user._id,
        name: args.name,
        keyHash: await hmacApiKey(apiKey),
        keyPrefix: previewApiKey(apiKey),
      },
    );

    return {
      ...result,
      apiKey,
    };
  },
});

export const insertApiKeyForUser = internalMutation({
  args: {
    userId: v.string(),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
  },
  handler: async (ctx, args): Promise<StoredApiKeyResult> => {
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    if (existing) {
      throw new Error("API key already exists");
    }

    const now = Date.now();
    const id = await ctx.db.insert("apiKeys", {
      userId: args.userId,
      name: normalizeName(args.name),
      keyHash: args.keyHash,
      keyPrefix: validateKeyPrefix(args.keyPrefix),
      createdAt: now,
    });

    return {
      id,
      createdAt: now,
    };
  },
});

export const revokeMyApiKey = mutation({
  args: {
    id: v.id("apiKeys"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== user._id || key.revokedAt) {
      return { revoked: false };
    }

    await ctx.db.patch(key._id, { revokedAt: Date.now() });
    return { revoked: true };
  },
});

export const validateApiKey = mutation({
  args: {
    apiKey: v.string(),
    repoFullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = args.apiKey.trim();
    if (!apiKey) {
      return { valid: false as const };
    }

    const keyHash = await hmacApiKey(apiKey);
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .first();

    if (!key || key.revokedAt) {
      return { valid: false as const };
    }

    const now = Date.now();
    await ctx.db.patch(key._id, { lastUsedAt: now });

    const connectedRepos = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", key.userId))
      .collect();

    const base = {
      valid: true as const,
      userId: key.userId,
      apiKeyId: key._id,
      keyName: key.name,
      lastUsedAt: now,
    };

    const repoFullName = args.repoFullName?.trim();
    if (repoFullName) {
      const repo =
        connectedRepos.find(
          (entry) => entry.fullName.toLowerCase() === repoFullName.toLowerCase(),
        ) ?? null;

      return {
        ...base,
        repoFullName,
        repoAccess: Boolean(repo),
        repo: repo
          ? {
              id: repo._id,
              githubId: repo.githubId,
              fullName: repo.fullName,
              private: repo.private,
              defaultBranch: repo.defaultBranch,
            }
          : null,
      };
    }

    return {
      ...base,
      connectedRepos: connectedRepos
        .map((repo) => ({
          id: repo._id,
          githubId: repo.githubId,
          fullName: repo.fullName,
          private: repo.private,
          defaultBranch: repo.defaultBranch,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  },
});
