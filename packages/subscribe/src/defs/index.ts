import { DocumentNode, ExecutionResult, GraphQLFieldResolver, GraphQLSchema } from "graphql";
import { ExecutionArgs, ExecutionResultDataDefault } from "graphql/execution/execute";
import Maybe from "graphql/tsutils/Maybe";

export interface UserOptions {
  /**
   * Set default GraphQL field resolver function to
   * be passed on to GraphQL's execute and subscribe
   * methods.
   */
  fieldResolver?: GraphQLFieldResolver<any, any>;

  /**
   * Set default GraphQL root value to be passed on to
   * GraphQL's execute and subscribe methods.
   */
  rootValue?: any;

  /**
   * The GraphQL schema.
   */
  schema: GraphQLSchema;

  /**
   * A GraphQL subscribe function to use
   * instead of the out-of-the-box function.
   */
  subscribe?: GraphQLSubscribe;

  /**
   * Set default GraphQL subscribe field resolver function.
   */
  subscribeFieldResolver?: GraphQLFieldResolver<any, any>;
}

export type InitOptions = UserOptions;

export type ConstructorOptions = UserOptions;

export type GraphQLSubscribe = <TData = ExecutionResultDataDefault>(args: {
  contextValue?: any;
  document: DocumentNode;
  fieldResolver?: Maybe<GraphQLFieldResolver<any, any>>;
  operationName?: Maybe<string>;
  rootValue?: any;
  schema: GraphQLSchema;
  subscribeFieldResolver?: Maybe<GraphQLFieldResolver<any, any>>;
  variableValues?: Maybe<{ [key: string]: any }>;
}) => Promise<AsyncIterator<ExecutionResult<TData>> | ExecutionResult<TData>>;

export interface SubscribeArgs extends ExecutionArgs {
  subscribeFieldResolver?: Maybe<GraphQLFieldResolver<any, any>>;
}
