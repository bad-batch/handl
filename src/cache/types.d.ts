import Cacheability from "cacheability";
import { DocumentNode, FieldNode } from "graphql";
import { CachemapOptions, DefaultCacheControls } from "../client/types";
import { CacheMetadata, ObjectMap } from "../types";

export interface AnalyzeResult {
  cachedData?: ObjectMap;
  cacheMetadata?: CacheMetadata;
  filtered?: boolean;
  updatedAST?: DocumentNode;
  updatedQuery?: string;
}

export interface CacheArgs {
  cachemapOptions: CachemapArgsGroup;
  defaultCacheControls: DefaultCacheControls;
}

export interface CheckDataObjectCacheEntryResult {
  cacheability: Cacheability | false;
  cacheData: any;
}

export type CheckList = Map<string, boolean>;

export interface GetKeysResult {
  cacheKey: string;
  dataKey: string;
  hashKey: string;
  name: string;
  propKey: string | number;
  queryKey: string;
}

export type IterateChildFieldsCallback = (childField: FieldNode, childIndex?: number) => void;

export interface KeyPaths {
  cachePath?: string;
  dataPath?: string;
  queryPath?: string;
}

export interface ObjectCacheCheckMetadata {
  cacheMetadata: CacheMetadata;
  checkList: CheckList;
  counter: { missing: number, total: number };
  queriedData: ObjectMap;
}

export interface PartialData {
  cachedData: ObjectMap;
  cacheMetadata: CacheMetadata;
}
