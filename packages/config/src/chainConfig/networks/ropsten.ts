/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

/* eslint-disable max-len */

// Ropsten beacon chain config:
// https://github.com/eth-clients/merge-testnets/blob/main/ropsten-beacon-chain/config.yaml

export const ropstenChainConfig: IChainConfig = {
  ...mainnet,

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 100000,
  // # Monday, May 30th, 2022 3:00:00 PM +UTC
  MIN_GENESIS_TIME: 1653318000,
  GENESIS_FORK_VERSION: b("0x80000069"),

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x80000070"),
  ALTAIR_FORK_EPOCH: 500,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x80000071"),
  BELLATRIX_FORK_EPOCH: 750,
  TERMINAL_TOTAL_DIFFICULTY: BigInt(100000000000000000000000),
  // # Sharding
  SHARDING_FORK_VERSION: b("0x03001020"),
  SHARDING_FORK_EPOCH: Infinity,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 3,
  DEPOSIT_NETWORK_ID: 3,
  DEPOSIT_CONTRACT_ADDRESS: b("0x6f22fFbC56eFF051aECF839396DD1eD9aD6BBA9D"),
};
