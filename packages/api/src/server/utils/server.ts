import * as fastify from "fastify";
import {mapValues} from "@chainsafe/lodestar-utils";
// eslint-disable-next-line import/no-extraneous-dependencies
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ReqGeneric, RouteGeneric, ReturnTypes, TypeJson, Resolves, RouteGroupDefinition} from "../../utils/types.js";
import {getFastifySchema} from "../../utils/schema.js";

// See /packages/api/src/routes/index.ts for reasoning

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention */

export type ServerRoute<Req extends ReqGeneric = ReqGeneric> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<Req>;
  schema?: fastify.FastifySchema;
  /** OperationId as defined in https://github.com/ethereum/beacon-APIs/blob/v2.1.0/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

/** Adaptor for Fastify v3.x.x route type which has a ton of arguments */
type FastifyHandler<Req extends ReqGeneric> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: Req["body"];
    Querystring: Req["query"];
    Params: Req["params"];
  },
  fastify.ContextConfigDefault
>;

export type ServerRoutes<Api extends Record<string, RouteGeneric>, ReqTypes extends {[K in keyof Api]: ReqGeneric}> = {
  [K in keyof Api]: ServerRoute<ReqTypes[K]>;
};

export function getGenericJsonServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  {routesData, getReqSerializers, getReturnTypes}: RouteGroupDefinition<Api, ReqTypes>,
  config: IChainForkConfig,
  api: Api
): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes(config);

  return mapValues(routesData, (routeDef, routeId) => {
    const routeSerdes = reqSerializers[routeId];
    const returnType = returnTypes[routeId as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return {
      url: routeDef.url,
      method: routeDef.method,
      id: routeId as string,
      schema: routeSerdes.schema && getFastifySchema(routeSerdes.schema),

      handler: async function handler(req: ReqGeneric): Promise<unknown | void> {
        const args: any[] = routeSerdes.parseReq(req as ReqTypes[keyof Api]);
        const data = (await api[routeId](...args)) as Resolves<Api[keyof Api]>;
        if (returnType) {
          return returnType.toJson(data);
        } else {
          return {};
        }
      },
    };
  });
}
