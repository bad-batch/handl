import { ClientArgs, RequestOptions, RequestResult } from "./types";
import { ServerArgs, ServerRequestOptions } from "./server/types";
export type HandlClientArgs = ClientArgs;
export type HandlClientRequestOptions = RequestOptions;
export type HandlClientRequestResult = RequestResult;
export type HandlServerArgs = ServerArgs;
export type HandlServerRequestOptions = ServerRequestOptions;
export { DefaultClient as DefaultHandl } from "./default-client";
export { ServerHandl } from "./server";
export { WorkerClient as WorkerHandl } from "./worker-client";
export { Client as Handl } from "./client";
