/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as githubAccess from "../githubAccess.js";
import type * as gxAuth from "../gxAuth.js";
import type * as gxAuthActions from "../gxAuthActions.js";
import type * as gxAuthUtils from "../gxAuthUtils.js";
import type * as gxBookmarkActions from "../gxBookmarkActions.js";
import type * as gxChangeReviewActions from "../gxChangeReviewActions.js";
import type * as gxChangeReviews from "../gxChangeReviews.js";
import type * as gxPr from "../gxPr.js";
import type * as gxPrActions from "../gxPrActions.js";
import type * as gxPrHttp from "../gxPrHttp.js";
import type * as gxReviewActions from "../gxReviewActions.js";
import type * as gxStackActions from "../gxStackActions.js";
import type * as http from "../http.js";
import type * as indexing from "../indexing.js";
import type * as indexingActions from "../indexingActions.js";
import type * as lib_chatPin from "../lib/chatPin.js";
import type * as lib_codeStorageAdapter from "../lib/codeStorageAdapter.js";
import type * as lib_gxPrGithub from "../lib/gxPrGithub.js";
import type * as lib_gxPrPayload from "../lib/gxPrPayload.js";
import type * as lib_gxStack from "../lib/gxStack.js";
import type * as lib_prChat_generateChatResponse from "../lib/prChat/generateChatResponse.js";
import type * as lib_prChatContext from "../lib/prChatContext.js";
import type * as lib_turbopuffer_chunkSourceFile from "../lib/turbopuffer/chunkSourceFile.js";
import type * as lib_turbopuffer_deleteStaleDocuments from "../lib/turbopuffer/deleteStaleDocuments.js";
import type * as lib_turbopuffer_embedTextBatch from "../lib/turbopuffer/embedTextBatch.js";
import type * as lib_turbopuffer_fetchGithubBlobs from "../lib/turbopuffer/fetchGithubBlobs.js";
import type * as lib_turbopuffer_fetchGithubTree from "../lib/turbopuffer/fetchGithubTree.js";
import type * as lib_turbopuffer_getGithubAppToken from "../lib/turbopuffer/getGithubAppToken.js";
import type * as lib_turbopuffer_indexLog from "../lib/turbopuffer/indexLog.js";
import type * as lib_turbopuffer_queryReviewContext from "../lib/turbopuffer/queryReviewContext.js";
import type * as lib_turbopuffer_retry from "../lib/turbopuffer/retry.js";
import type * as lib_turbopuffer_runIndexRepo from "../lib/turbopuffer/runIndexRepo.js";
import type * as lib_turbopuffer_turbopufferClient from "../lib/turbopuffer/turbopufferClient.js";
import type * as lib_turbopuffer_upsertDocuments from "../lib/turbopuffer/upsertDocuments.js";
import type * as lib_turbopuffer_utils from "../lib/turbopuffer/utils.js";
import type * as prChatActions from "../prChatActions.js";
import type * as repoActions from "../repoActions.js";
import type * as repos from "../repos.js";
import type * as searchActions from "../searchActions.js";
import type * as stripeActions from "../stripeActions.js";
import type * as stripeUrls from "../stripeUrls.js";
import type * as stripeWebhookActions from "../stripeWebhookActions.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  billing: typeof billing;
  githubAccess: typeof githubAccess;
  gxAuth: typeof gxAuth;
  gxAuthActions: typeof gxAuthActions;
  gxAuthUtils: typeof gxAuthUtils;
  gxBookmarkActions: typeof gxBookmarkActions;
  gxChangeReviewActions: typeof gxChangeReviewActions;
  gxChangeReviews: typeof gxChangeReviews;
  gxPr: typeof gxPr;
  gxPrActions: typeof gxPrActions;
  gxPrHttp: typeof gxPrHttp;
  gxReviewActions: typeof gxReviewActions;
  gxStackActions: typeof gxStackActions;
  http: typeof http;
  indexing: typeof indexing;
  indexingActions: typeof indexingActions;
  "lib/chatPin": typeof lib_chatPin;
  "lib/codeStorageAdapter": typeof lib_codeStorageAdapter;
  "lib/gxPrGithub": typeof lib_gxPrGithub;
  "lib/gxPrPayload": typeof lib_gxPrPayload;
  "lib/gxStack": typeof lib_gxStack;
  "lib/prChat/generateChatResponse": typeof lib_prChat_generateChatResponse;
  "lib/prChatContext": typeof lib_prChatContext;
  "lib/turbopuffer/chunkSourceFile": typeof lib_turbopuffer_chunkSourceFile;
  "lib/turbopuffer/deleteStaleDocuments": typeof lib_turbopuffer_deleteStaleDocuments;
  "lib/turbopuffer/embedTextBatch": typeof lib_turbopuffer_embedTextBatch;
  "lib/turbopuffer/fetchGithubBlobs": typeof lib_turbopuffer_fetchGithubBlobs;
  "lib/turbopuffer/fetchGithubTree": typeof lib_turbopuffer_fetchGithubTree;
  "lib/turbopuffer/getGithubAppToken": typeof lib_turbopuffer_getGithubAppToken;
  "lib/turbopuffer/indexLog": typeof lib_turbopuffer_indexLog;
  "lib/turbopuffer/queryReviewContext": typeof lib_turbopuffer_queryReviewContext;
  "lib/turbopuffer/retry": typeof lib_turbopuffer_retry;
  "lib/turbopuffer/runIndexRepo": typeof lib_turbopuffer_runIndexRepo;
  "lib/turbopuffer/turbopufferClient": typeof lib_turbopuffer_turbopufferClient;
  "lib/turbopuffer/upsertDocuments": typeof lib_turbopuffer_upsertDocuments;
  "lib/turbopuffer/utils": typeof lib_turbopuffer_utils;
  prChatActions: typeof prChatActions;
  repoActions: typeof repoActions;
  repos: typeof repos;
  searchActions: typeof searchActions;
  stripeActions: typeof stripeActions;
  stripeUrls: typeof stripeUrls;
  stripeWebhookActions: typeof stripeWebhookActions;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
