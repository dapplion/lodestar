import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Api} from "../interface.js";
import {IHttpClient, HttpClient, HttpClientOptions, HttpClientModules, HttpError} from "./utils/index.js";
export {HttpClient, HttpClientOptions, HttpError};

import * as beacon from "./beacon.js";
import * as configApi from "./config.js";
import * as debug from "./debug.js";
import * as events from "./events.js";
import * as lightclient from "./lightclient.js";
import * as lodestar from "./lodestar.js";
import * as node from "./node.js";
import * as validator from "./validator.js";

type ClientModules = HttpClientModules & {
  config: IChainForkConfig;
  httpClient?: IHttpClient;
};

/**
 * REST HTTP client for all routes
 */
export function getClient(opts: HttpClientOptions, modules: ClientModules): Api {
  const {config} = modules;
  const httpClient = modules.httpClient ?? new HttpClient(opts, modules);

  return {
    beacon: beacon.getClient(config, httpClient),
    config: configApi.getClient(config, httpClient),
    debug: debug.getClient(config, httpClient),
    events: events.getClient(config, httpClient.baseUrl),
    lightclient: lightclient.getClient(config, httpClient),
    lodestar: lodestar.getClient(config, httpClient),
    node: node.getClient(config, httpClient),
    validator: validator.getClient(config, httpClient),
  };
}
