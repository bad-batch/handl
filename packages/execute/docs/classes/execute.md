[Documentation](../README.md) › [Execute](execute.md)

# Class: Execute

## Hierarchy

* **Execute**

## Implements

* RequestManagerDef

## Index

### Constructors

* [constructor](execute.md#constructor)

### Methods

* [execute](execute.md#execute)
* [init](execute.md#static-init)

## Constructors

###  constructor

\+ **new Execute**(`options`: [ConstructorOptions](../README.md#constructoroptions)): *[Execute](execute.md)*

*Defined in [main/index.ts:30](https://github.com/badbatch/graphql-box/blob/9a898ad/packages/execute/src/main/index.ts#L30)*

**Parameters:**

Name | Type |
------ | ------ |
`options` | [ConstructorOptions](../README.md#constructoroptions) |

**Returns:** *[Execute](execute.md)*

## Methods

###  execute

▸ **execute**(`__namedParameters`: object, `options`: ServerRequestOptions, `__namedParameters`: object): *Promise‹MaybeRawResponseData›*

*Defined in [main/index.ts:40](https://github.com/badbatch/graphql-box/blob/9a898ad/packages/execute/src/main/index.ts#L40)*

**Parameters:**

▪ **__namedParameters**: *object*

Name | Type |
------ | ------ |
`ast` | undefined &#124; DocumentNode |
`request` | string |

▪ **options**: *ServerRequestOptions*

▪ **__namedParameters**: *object*

Name | Type |
------ | ------ |
`boxID` | string |

**Returns:** *Promise‹MaybeRawResponseData›*

___

### `Static` init

▸ **init**(`options`: [InitOptions](../README.md#initoptions)): *Promise‹[Execute](execute.md)›*

*Defined in [main/index.ts:15](https://github.com/badbatch/graphql-box/blob/9a898ad/packages/execute/src/main/index.ts#L15)*

**Parameters:**

Name | Type |
------ | ------ |
`options` | [InitOptions](../README.md#initoptions) |

**Returns:** *Promise‹[Execute](execute.md)›*
