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
import type * as gxPr from "../gxPr.js";
import type * as gxPrHttp from "../gxPrHttp.js";
import type * as http from "../http.js";
import type * as repoActions from "../repoActions.js";
import type * as repos from "../repos.js";
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
  gxPr: typeof gxPr;
  gxPrHttp: typeof gxPrHttp;
  http: typeof http;
  repoActions: typeof repoActions;
  repos: typeof repos;
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
