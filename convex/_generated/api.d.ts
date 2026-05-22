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
import type * as gxReviewActions from "../gxReviewActions.js";
import type * as http from "../http.js";
import type * as indexing from "../indexing.js";
import type * as indexingActions from "../indexingActions.js";
import type * as repoActions from "../repoActions.js";
import type * as repos from "../repos.js";
import type * as searchActions from "../searchActions.js";
import type * as stripeActions from "../stripeActions.js";
import type * as stripeUrls from "../stripeUrls.js";
import type * as stripeWebhookActions from "../stripeWebhookActions.js";

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
  gxReviewActions: typeof gxReviewActions;
  http: typeof http;
  indexing: typeof indexing;
  indexingActions: typeof indexingActions;
  repoActions: typeof repoActions;
  repos: typeof repos;
  searchActions: typeof searchActions;
  stripeActions: typeof stripeActions;
  stripeUrls: typeof stripeUrls;
  stripeWebhookActions: typeof stripeWebhookActions;
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
