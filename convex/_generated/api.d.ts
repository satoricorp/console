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
import type * as devices from "../devices.js";
import type * as githubAccess from "../githubAccess.js";
import type * as githubAppInstall from "../githubAppInstall.js";
import type * as githubProfile from "../githubProfile.js";
import type * as githubTokenAudience from "../githubTokenAudience.js";
import type * as gxAuth from "../gxAuth.js";
import type * as gxAuthActions from "../gxAuthActions.js";
import type * as gxAuthUtils from "../gxAuthUtils.js";
import type * as http from "../http.js";
import type * as indexing from "../indexing.js";
import type * as indexingActions from "../indexingActions.js";
import type * as lib_trialDays from "../lib/trialDays.js";
import type * as lib_turbopuffer_chunkSourceFile from "../lib/turbopuffer/chunkSourceFile.js";
import type * as lib_turbopuffer_deleteStaleDocuments from "../lib/turbopuffer/deleteStaleDocuments.js";
import type * as lib_turbopuffer_embedTextBatch from "../lib/turbopuffer/embedTextBatch.js";
import type * as lib_turbopuffer_fetchGithubCompare from "../lib/turbopuffer/fetchGithubCompare.js";
import type * as lib_turbopuffer_fetchGithubTarball from "../lib/turbopuffer/fetchGithubTarball.js";
import type * as lib_turbopuffer_fetchGithubTree from "../lib/turbopuffer/fetchGithubTree.js";
import type * as lib_turbopuffer_getGithubAppToken from "../lib/turbopuffer/getGithubAppToken.js";
import type * as lib_turbopuffer_indexLog from "../lib/turbopuffer/indexLog.js";
import type * as lib_turbopuffer_retry from "../lib/turbopuffer/retry.js";
import type * as lib_turbopuffer_runIndexRepo from "../lib/turbopuffer/runIndexRepo.js";
import type * as lib_turbopuffer_tokenClamp from "../lib/turbopuffer/tokenClamp.js";
import type * as lib_turbopuffer_turbopufferClient from "../lib/turbopuffer/turbopufferClient.js";
import type * as lib_turbopuffer_upsertDocuments from "../lib/turbopuffer/upsertDocuments.js";
import type * as lib_turbopuffer_utils from "../lib/turbopuffer/utils.js";
import type * as orgs from "../orgs.js";
import type * as profile from "../profile.js";
import type * as repoActions from "../repoActions.js";
import type * as repos from "../repos.js";
import type * as stripeWebhookActions from "../stripeWebhookActions.js";
import type * as userAppState from "../userAppState.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  billing: typeof billing;
  devices: typeof devices;
  githubAccess: typeof githubAccess;
  githubAppInstall: typeof githubAppInstall;
  githubProfile: typeof githubProfile;
  githubTokenAudience: typeof githubTokenAudience;
  gxAuth: typeof gxAuth;
  gxAuthActions: typeof gxAuthActions;
  gxAuthUtils: typeof gxAuthUtils;
  http: typeof http;
  indexing: typeof indexing;
  indexingActions: typeof indexingActions;
  "lib/trialDays": typeof lib_trialDays;
  "lib/turbopuffer/chunkSourceFile": typeof lib_turbopuffer_chunkSourceFile;
  "lib/turbopuffer/deleteStaleDocuments": typeof lib_turbopuffer_deleteStaleDocuments;
  "lib/turbopuffer/embedTextBatch": typeof lib_turbopuffer_embedTextBatch;
  "lib/turbopuffer/fetchGithubCompare": typeof lib_turbopuffer_fetchGithubCompare;
  "lib/turbopuffer/fetchGithubTarball": typeof lib_turbopuffer_fetchGithubTarball;
  "lib/turbopuffer/fetchGithubTree": typeof lib_turbopuffer_fetchGithubTree;
  "lib/turbopuffer/getGithubAppToken": typeof lib_turbopuffer_getGithubAppToken;
  "lib/turbopuffer/indexLog": typeof lib_turbopuffer_indexLog;
  "lib/turbopuffer/retry": typeof lib_turbopuffer_retry;
  "lib/turbopuffer/runIndexRepo": typeof lib_turbopuffer_runIndexRepo;
  "lib/turbopuffer/tokenClamp": typeof lib_turbopuffer_tokenClamp;
  "lib/turbopuffer/turbopufferClient": typeof lib_turbopuffer_turbopufferClient;
  "lib/turbopuffer/upsertDocuments": typeof lib_turbopuffer_upsertDocuments;
  "lib/turbopuffer/utils": typeof lib_turbopuffer_utils;
  orgs: typeof orgs;
  profile: typeof profile;
  repoActions: typeof repoActions;
  repos: typeof repos;
  stripeWebhookActions: typeof stripeWebhookActions;
  userAppState: typeof userAppState;
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
