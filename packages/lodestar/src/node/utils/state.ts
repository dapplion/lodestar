import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Deposit} from "@chainsafe/lodestar-types";
import {interopDeposits} from "./interop/deposits";
import {getInteropState} from "./interop/state";
import {mkdirSync, writeFileSync} from "fs";
import {dirname} from "path";
import {BeaconNode} from "../nodejs";
import {IBeaconDb} from "../../db/api";
import {TreeBacked} from "@chainsafe/ssz";

export async function initDevChain({
  node,
  validatorCount,
  offset,
  genesisTime
}: {
  node: BeaconNode;
  validatorCount: number;
  offset?: number;
  genesisTime?: number;
}): Promise<TreeBacked<BeaconState>> {
  const deposits = interopDeposits(
    node.config,
    node.config.types.DepositDataRootList.tree.defaultValue(),
    validatorCount,
    offset
  );
  await storeDeposits(node.config, node.db, deposits);
  const state = getInteropState(
    node.config,
    await node.db.depositDataRoot.getTreeBacked(validatorCount - 1),
    genesisTime || Math.floor(Date.now() / 1000),
    deposits
  );
  await node.chain.initializeBeaconChain(state);
  return state;
}

export function storeSSZState(config: IBeaconConfig, state: TreeBacked<BeaconState>, path: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, config.types.BeaconState.serialize(state));
}

async function storeDeposits(config: IBeaconConfig, db: IBeaconDb, deposits: Deposit[]): Promise<void> {
  for (let i = 0; i < deposits.length; i++) {
    await Promise.all([
      db.depositData.put(i, deposits[i].data),
      db.depositDataRoot.put(i, config.types.DepositData.hashTreeRoot(deposits[i].data)),
    ]);
  }
}
