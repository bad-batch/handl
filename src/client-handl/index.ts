import { Cacheability } from "cacheability";
import * as EventEmitter from "eventemitter3";

import {
  buildClientSchema,
  DocumentNode,
  ExecutionResult,
  GraphQLError,
  GraphQLSchema,
  validate,
} from "graphql";

import "isomorphic-fetch";
import { isAsyncIterable } from "iterall";

import {
  get,
  isArray,
  isPlainObject,
  isString,
  merge,
} from "lodash";

import { getOperationDefinitions } from "../helpers/parsing";
import rehydrateCacheMetadata from "../helpers/rehydrate-cache-metadata";
import CacheManager from "../cache-manager";
import handlDebugger from "../debuggers/client-handl";
import FetchManager from "../fetch-manager";
import createCacheMetadata from "../helpers/create-cache-metadata";
import dehydrateCacheMetadata from "../helpers/dehydrate-cache-metadata";
import hashRequest from "../helpers/hash-request";
import * as uuid from "uuid/v1";
import { FetchResult, ResolveArgs } from "./types";
import socketsSupported from "../helpers/sockets-supported";
import { logFetch, logRequest, logSubscription } from "../monitoring";
import { timeRequest } from "../performance";
import GraphQLExecuteProxy from "../proxies/graphql-execute";
import GraphQLSubscribeProxy from "../proxies/graphql-subscribe";
import { RequestParser } from "../request-parser";
import SocketManager from "../socket-manager";

import {
  CachemapArgsGroup,
  CachemapOptions,
  CachemapOptionsGroup,
  CacheMetadata,
  ClientArgs,
  DefaultCacheControls,
  DehydratedCacheMetadata,
  ExportCachesResult,
  ObjectMap,
  PendingRequestActions,
  PendingRequestRejection,
  PendingRequestResolver,
  RequestContext,
  RequestOptions,
  RequestResult,
  ResolveResult,
  ResponseCacheEntryResult,
  SchemaTypeMap,
} from "../types";

const deferredPromise = require("defer-promise");
let GraphQLExecute: typeof GraphQLExecuteProxy;
let GraphQLSubscribe: typeof GraphQLSubscribeProxy;

if (!process.env.WEB_ENV) {
  GraphQLExecute = require("../proxies/graphql-execute").default;
  GraphQLSubscribe = require("../proxies/graphql-subscribe").default;
}

let instance: ClientHandl;

/**
 * An isomorphic GraphQL client that works on the
 * server and in a browser.
 *
 */
export class ClientHandl {
  /**
   * The method creates an instance of either ClientHandl for
   * the server or ClientHandl for the browser based on whether the
   * `WEB_ENV` environment variable is set to `"true"`.
   *
   */
  public static async create(args: ClientArgs): Promise<ClientHandl> {
    if (instance && isPlainObject(args) && !args.newInstance) return instance;

    try {
      const client = new ClientHandl(args);
      await client._createCache();
      instance = client;
      return instance;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method turns the cacheMetadata map into a
   * plain object that can be serialised and transported.
   *
   */
  public static dehydrateCacheMetadata(cacheMetadata?: CacheMetadata): DehydratedCacheMetadata {
    return dehydrateCacheMetadata(cacheMetadata);
  }

  /**
   * The method turn a cacheMetadata plain object into
   * a map of Cacheability objects.
   *
   */
  public static rehydrateCacheMetadata(dehydratedCacheMetadata: DehydratedCacheMetadata): CacheMetadata {
    return rehydrateCacheMetadata(dehydratedCacheMetadata);
  }

  private _cache: CacheManager;

  private _cachemapOptions: CachemapArgsGroup = {
    dataEntities: {
      indexedDBOptions: {
        databaseName: "handl-dataEntities-store",
        objectStoreName: "dataEntities",
      },
      name: "handl-dataEntities",
      redisOptions: { db: 0 },
      use: { client: "indexedDB", server: "redis" },
    },
    queryPaths: {
      indexedDBOptions: {
        databaseName: "handl-queryPaths-store",
        objectStoreName: "queryPaths",
      },
      name: "handl-queryPaths",
      redisOptions: { db: 1 },
      use: { client: "indexedDB", server: "redis" },
    },
    responses: {
      indexedDBOptions: {
        databaseName: "handl-responses-store",
        objectStoreName: "responses",
      },
      name: "handl-responses",
      redisOptions: { db: 2 },
      use: { client: "indexedDB", server: "redis" },
    },
  };

  private _debugger: EventEmitter = handlDebugger;

  private _defaultCacheControls: DefaultCacheControls = {
    mutation: "max-age=0, s-maxage=0, no-cache, no-store",
    query: "public, max-age=60, s-maxage=60",
    subscription: "max-age=0, s-maxage=0, no-cache, no-store",
  };

  private _mode: "default" | "server" = "default";
  private _requestExecutor: FetchManager | GraphQLExecuteProxy;
  private _requestParser: RequestParser;
  private _requestSubscriber: SocketManager | GraphQLSubscribeProxy;
  private _resourceKey: string = "id";
  private _schema: GraphQLSchema;
  private _subscriptionsEnabled: boolean = false;
  private _typeCacheControls: ObjectMap;

  constructor(args: ClientArgs) {
    if (!isPlainObject(args)) {
      throw new TypeError("Constructor expected args to be a plain object.");
    }

    const {
      batch,
      cachemapOptions,
      defaultCacheControls,
      fetchTimeout,
      fieldResolver,
      headers,
      introspection,
      mode,
      resourceKey,
      rootValue,
      schema,
      subscribeFieldResolver,
      subscriptions,
      typeCacheControls,
      url,
    } = args;

    const errors: TypeError[] = [];
    if (mode === "server" && !process.env.WEB_ENV) this._mode = mode;

    if (this._mode === "default") {
      if (introspection && isPlainObject(introspection)) {
        this._schema = buildClientSchema(introspection);
      } else {
        errors.push(new TypeError("Constructor expected introspection to be a plain object."));
      }

      if (isString(url)) {
        this._requestExecutor = new FetchManager({ batch, fetchTimeout, headers, url });
      } else {
        errors.push(new TypeError("Constructor expected url to be a string."));
      }

      if (socketsSupported() && subscriptions && isPlainObject(subscriptions)) {
        this._requestSubscriber = new SocketManager(subscriptions.address, subscriptions.opts);
        this._subscriptionsEnabled = true;
      }
    }

    if (this._mode === "server") {
      if (schema instanceof GraphQLSchema) {
        this._requestExecutor = new GraphQLExecute({ fieldResolver, rootValue, schema });
        this._requestSubscriber = new GraphQLSubscribe({ fieldResolver, rootValue, schema, subscribeFieldResolver });
        this._schema = schema;
        this._subscriptionsEnabled = true;
      } else {
        errors.push(new TypeError("Constructor expected schema to be an instance of GraphQLSchema."));
      }
    }

    if (errors.length) throw errors;

    if (cachemapOptions && isPlainObject(cachemapOptions)) {
      this._setCachemapOptions(cachemapOptions);
    }

    if (defaultCacheControls && isPlainObject(defaultCacheControls)) {
      this._defaultCacheControls = { ...this._defaultCacheControls, ...defaultCacheControls };
    }

    if (isString(resourceKey)) this._resourceKey = resourceKey;
    this._requestParser = new RequestParser(this._schema, this._resourceKey);
    if (typeCacheControls && isPlainObject(typeCacheControls)) this._typeCacheControls = typeCacheControls;
  }

  /**
   * The method removes all cache entries from all three caches.
   *
   */
  public async clearCache(): Promise<void> {
    try {
      await Promise.all([
        this._cache.queryPaths.clear(),
        this._cache.dataEntities.clear(),
        this._cache.responses.clear(),
      ]);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method returns all cache entries from all three caches
   * or a subset of cache entries based on a 'tag' in a
   * serializable format that can be imported by another handl.
   *
   */
  public async exportCaches(tag: any): Promise<ExportCachesResult> {
    try {
      return this._cache.export(tag);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Given a valid key, the method returns the matching entry
   * from the data entity cache.
   *
   */
  public async getDataEntityCacheEntry(key: string): Promise<ObjectMap | undefined> {
    try {
      return this._cache.dataEntities.get(key);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method returns the number of entries in the data
   * entity cache.
   *
   */
  public async getDataEntityCacheSize(): Promise<number> {
    try {
      return this._cache.dataEntities.size();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Given a valid key, the method returns the matching entry
   * from the query path cache.
   *
   */
  public async getQueryPathCacheEntry(key: string): Promise<any> {
    try {
      return this._cache.queryPaths.get(key);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method returns the number of entries in the query
   * path cache.
   *
   */
  public async getQueryPathCacheSize(): Promise<number> {
    try {
      return this._cache.queryPaths.size();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Given a valid key, the method returns the matching entry
   * from the response cache.
   *
   */
  public async getResponseCacheEntry(key: string): Promise<ResponseCacheEntryResult | undefined> {
    try {
      const entry = await this._cache.responses.get(key);
      if (!entry) return undefined;
      const { cacheMetadata, data } = entry;
      return { cacheMetadata: createCacheMetadata({ cacheMetadata }), data };
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method returns the number of entries in the response cache.
   *
   */
  public async getResponseCacheSize(): Promise<number> {
    try {
      return this._cache.responses.size();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The method returns a map of schema types.
   *
   */
  public async getSchemaTypeMap(): Promise<SchemaTypeMap> {
    return this._schema.getTypeMap();
  }

  /**
   * The method imports data exported by another handl
   * into the caches.
   *
   */
  public async importCaches(caches: ExportCachesResult): Promise<void> {
    try {
      return this._cache.import(caches);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Remove listener for one of the debug events.
   *
   */
  public off(eventName: string, callback?: (...args: any[]) => void, context?: any): EventEmitter {
    return this._debugger.off(eventName, callback, context);
  }

  /**
   * Add listener for one of the debug events.
   *
   */
  public on(eventName: string, callback: (...args: any[]) => void, context?: any): EventEmitter {
    return this._debugger.on(eventName, callback, context);
  }

  /**
   * The method makes query, mutation and subscription requests and
   * handles request parsing, filtering and caching.
   *
   */
  public async request(query: string, opts: RequestOptions = {}): Promise<RequestResult> {
    const context: RequestContext = {
      fieldTypeMap: new Map(),
      handlID: uuid(),
      operation: "",
      operationName: "",
    };

    return this._request(query, opts, context);
  }

  private async _checkResponseCache(queryHash: string, context: RequestContext): Promise<ResolveResult | undefined> {
    try {
      const cacheability = await this._cache.responses.has(queryHash);
      if (!this._cache.isValid(cacheability)) return undefined;
      const res = await this._cache.responses.get(queryHash, {}, { ...context, cache: "responses" });
      return { cacheMetadata: rehydrateCacheMetadata(res.cacheMetadata), data: res.data };
    } catch (error) {
      return undefined;
    }
  }

  private async _createCache(): Promise<void> {
    try {
      this._cache = await CacheManager.create({
        cachemapOptions: this._cachemapOptions,
        defaultCacheControls: this._defaultCacheControls,
        resourceKey: this._resourceKey,
        typeCacheControls: this._typeCacheControls,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  @logFetch
  private async _fetch(
    request: string,
    ast: DocumentNode,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<FetchResult> {
    try {
      const result = await this._requestExecutor.resolve(request, ast, opts);
      if (result.errors) return Promise.reject(result.errors);

      return {
        cacheMetadata: result.cacheMetadata,
        data: result.data as ObjectMap,
        headers: result.headers as Headers,
      };
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async _mutation(
    mutation: string,
    ast: DocumentNode,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<ResolveResult> {
    let fetchResult: FetchResult;

    try {
      fetchResult = await this._fetch(mutation, ast, opts, context);
    } catch (error) {
      return this._resolve({ error, operation: "mutation" });
    }

    const cacheMetadata = createCacheMetadata({
      cacheMetadata: fetchResult.cacheMetadata,
      headers: fetchResult.headers,
    });

    const deferred: DeferPromise.Deferred<void> = deferredPromise();

    const resolveResult = await this._cache.resolveMutation(
      ast,
      fetchResult.data,
      cacheMetadata,
      { cacheResolve: deferred.resolve, tag: opts.tag },
      context,
    );

    return this._resolve({
      cacheMetadata: resolveResult.cacheMetadata,
      cachePromise: deferred.promise,
      data: resolveResult.data,
      operation: "mutation",
    });
  }

  private async _query(
    query: string,
    ast: DocumentNode,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<ResolveResult> {
    const queryHash = hashRequest(query);
    const cachedResponse = await this._checkResponseCache(queryHash, context);

    if (cachedResponse) {
      return this._resolve({
        cacheMetadata: cachedResponse.cacheMetadata,
        data: cachedResponse.data,
        operation: "query",
        queryHash,
        resolvePending: false,
      });
    }

    if (this._cache.requests.active.has(queryHash)) {
      return new Promise((resolve: PendingRequestResolver, reject: PendingRequestRejection) => {
        this._setPendingRequest(queryHash, { reject, resolve });
      });
    }

    this._cache.requests.active.set(queryHash, query);
    const analyzeResult = await this._cache.analyze(queryHash, ast, context);
    const { cachedData, cacheMetadata, filtered, updatedAST, updatedQuery } = analyzeResult;
    const deferred: DeferPromise.Deferred<void> = deferredPromise();

    if (cachedData && cacheMetadata) {
      const defaultCacheControl = this._defaultCacheControls.query;
      const queryCacheability = cacheMetadata.get("query");
      const cacheControl = queryCacheability && queryCacheability.printCacheControl() || defaultCacheControl;

      (async () => {
        try {
          await this._cache.responses.set(
            queryHash,
            { cacheMetadata: dehydrateCacheMetadata(cacheMetadata), data: cachedData },
            { cacheHeaders: { cacheControl }, tag: opts.tag },
            { ...context, cache: "responses" },
          );
        } catch (error) {
          // no catch
        } finally {
          deferred.resolve();
        }
      })();

      return this._resolve({
        cacheMetadata,
        cachePromise: deferred.promise,
        data: cachedData,
        operation: "query",
        queryHash,
      });
    }

    let fetchResult: FetchResult;
    const _updateQuery = updatedQuery as string;
    const _updateAST = updatedAST as DocumentNode;
    const _filterd = filtered as boolean;

    try {
      fetchResult = await this._fetch(_updateQuery, _updateAST, opts, context);
    } catch (error) {
      return this._resolve({ error, operation: "query", queryHash });
    }

    const _cacheMetadata = createCacheMetadata({
      cacheMetadata: fetchResult.cacheMetadata,
      headers: fetchResult.headers,
    });

    const resolveResult = await this._cache.resolveQuery(
      _updateQuery,
      _updateAST,
      queryHash,
      fetchResult.data,
      _cacheMetadata,
      { cacheResolve: deferred.resolve, filtered: _filterd, tag: opts.tag },
      context,
    );

    return this._resolve({
      cacheMetadata: resolveResult.cacheMetadata,
      cachePromise: deferred.promise,
      data: resolveResult.data,
      operation: "query",
      queryHash,
    });
  }

  @logRequest
  @timeRequest
  private async _request(query: string, opts: RequestOptions = {}, context: RequestContext): Promise<RequestResult> {
    let errors: Error[] = [];

    if (!isString(query)) {
      errors.push(new TypeError("Request expected query to be a string."));
    }

    if (!isPlainObject(opts)) {
      errors.push(new TypeError("Request expected opts to be a plain object."));
    }

    if (errors.length) return Promise.reject(errors);

    if (opts.fragments && (!isArray(opts.fragments) || opts.fragments.some((value) => !isString(value)))) {
      return Promise.reject(new TypeError("Request expected opts.fragments to be an array of strings."));
    }

    try {
      const updated = await this._requestParser.updateRequest(query, opts, context);
      errors = validate(this._schema, updated.ast) as GraphQLError[];
      if (errors.length) return Promise.reject(errors);
      const operationDefinitions = getOperationDefinitions(updated.ast);

      if (operationDefinitions.length > 1) {
        return Promise.reject(new TypeError("Request expected to process one operation, but got multiple."));
      }

      context.operation = operationDefinitions[0].operation;
      context.operationName = get(operationDefinitions[0], ["name", "value"], "");
      const result = await this._resolveRequestOperation(updated.query, updated.ast, opts, context);
      if (isAsyncIterable(result)) return result;
      const resolveResult = result as ResolveResult;
      if (opts.awaitDataCached && resolveResult.cachePromise) await resolveResult.cachePromise;
      delete resolveResult.cachePromise;
      return result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async _resolve(args: ResolveArgs): Promise<ResolveResult> {
    const { cacheMetadata, cachePromise, data, error, operation, queryHash, resolvePending = true } = args;

    if (cacheMetadata && !cacheMetadata.has("query")) {
      const cacheability = new Cacheability();
      cacheability.parseCacheControl(this._defaultCacheControls[operation]);
      cacheMetadata.set("query", cacheability);
    }

    if (resolvePending && queryHash) {
      this._resolvePendingRequests(queryHash, cacheMetadata, data, error);
      this._cache.requests.active.delete(queryHash);
    }

    if (error) return Promise.reject(error);

    const output: ResolveResult = {
      cacheMetadata: cacheMetadata as CacheMetadata,
      data: data as ObjectMap,
    };

    if (cachePromise) output.cachePromise = cachePromise;
    if (queryHash) output.queryHash = queryHash as string;
    return output;
  }

  private _resolvePendingRequests(
    queryHash: string,
    cacheMetadata?: CacheMetadata,
    data?: ObjectMap,
    error?: Error | Error[],
  ): void {
    const pendingRequests = this._cache.requests.pending.get(queryHash);
    if (!pendingRequests) return;

    pendingRequests.forEach(({ reject, resolve }) => {
      if (error) {
        reject(error);
      } else {
        resolve({
          cacheMetadata: cacheMetadata as CacheMetadata,
          data: data as ObjectMap,
          queryHash,
        });
      }
    });

    this._cache.requests.pending.delete(queryHash);
  }

  private _resolveRequestOperation(
    query: string,
    ast: DocumentNode,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<ResolveResult | AsyncIterator<any>> {
    if (context.operation === "query") {
      return this._query(query, ast, opts, context);
    } else if (context.operation === "mutation") {
      return this._mutation(query, ast, opts, context);
    } else if (context.operation === "subscription" && this._subscriptionsEnabled) {
      return this._subscription(query, ast, opts, context);
    }

    return Promise.reject(new Error("Request expected the operation to be 'query', 'mutation' or 'subscription'."));
  }

  @logSubscription
  private async _resolveSubscriber(
    ast: DocumentNode,
    result: ObjectMap,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<ResolveResult> {
    if (!isPlainObject(result)) {
      return this._resolve({
        error: new TypeError("Subscriber expected the result to be a JSON object."),
        operation: "subscription",
      });
    }

    if (isArray(result.errors) && result.errors[0] instanceof Error) {
      return this._resolve({ error: result.errors, operation: "subscription" });
    }

    const deferred: DeferPromise.Deferred<void> = deferredPromise();

    const resolveResult = await this._cache.resolveSubscription(
      ast,
      result.data,
      createCacheMetadata({ cacheMetadata: result.cacheMetadata }),
      { cacheResolve: deferred.resolve, tag: opts.tag },
      context,
    );

    if (opts.awaitDataCached) await deferred.promise;

    return this._resolve({
      cacheMetadata: resolveResult.cacheMetadata,
      data: resolveResult.data,
      operation: "subscription",
    });
  }

  private _setCachemapOptions(args: CachemapOptionsGroup | CachemapOptions): void {
    const defaultKeys = Object.keys(this._cachemapOptions);
    const argKeys = Object.keys(args);
    const hasMatch = defaultKeys.some((key) => argKeys.includes(key));

    if (!hasMatch) {
      defaultKeys.forEach((key) => {
        merge(this._cachemapOptions[key], args as CachemapOptions);
      });
    } else {
      merge(this._cachemapOptions, args as CachemapOptionsGroup);
    }
  }

  private _setPendingRequest(queryHash: string, { reject, resolve }: PendingRequestActions): void {
    let pending = this._cache.requests.pending.get(queryHash);
    if (!pending) pending = [];
    pending.push({ reject, resolve });
    this._cache.requests.pending.set(queryHash, pending);
  }

  private async _subscription(
    subscription: string,
    ast: DocumentNode,
    opts: RequestOptions,
    context: RequestContext,
  ): Promise<ResolveResult | AsyncIterator<any>> {
    const hash = hashRequest(subscription);

    try {
      const subscribeResult = await this._requestSubscriber.resolve(
        subscription,
        hash,
        ast,
        async (result) => this._resolveSubscriber(ast, result, opts, context),
        opts,
      );

      if (isAsyncIterable(subscribeResult)) return subscribeResult as AsyncIterator<any>;
      const executionResult = subscribeResult as ExecutionResult;
      if (executionResult.errors) return Promise.reject(executionResult.errors);
      return this._resolveSubscriber(ast, executionResult, opts, context);
    } catch (error) {
      return this._resolve({ error, operation: "subscription" });
    }
  }
}
