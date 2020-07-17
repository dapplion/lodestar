import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {getDevValidators} from "../utils/node/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {BeaconNode} from "../../src/node";

describe.only("no eth1 sim", function () {

  const nodeCount = 4;
  const validatorsPerNode = 20;
  const beaconParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };
  
  it(`Run ${nodeCount} nodes, ${validatorsPerNode} validators each`, async function () {
    this.timeout(0);

    const nodes: BeaconNode[] = [];
    const validators: Validator[] = [];
    const genesisTime = Math.floor(Date.now() / 1000);

    for (let i=0; i<nodeCount; i++) {
      const node = await getDevBeaconNode({
        params: beaconParams,
        options: {sync: {minPeers: 0}},
        validatorCount: validatorsPerNode,
        offset: i * validatorsPerNode,
        genesisTime
      });
      console.log(`Created node ${i}`);
      const nodeValidators = getDevValidators(node, validatorsPerNode);
      await node.start();
      console.log(`Started node ${i}`);

      // Connect new node to existing nodes
      for (const existingNode of nodes) {
        await node.network.connect(existingNode.network.peerId, existingNode.network.multiaddrs);
      }

      for (const validator of nodeValidators) {
        await validator.start();
        validators.push(validator);
        console.log(`Started node ${i} validator`);
      }

      nodes.push(node);
    }

    // Wait for finalized checkpoint on all nodes
    await Promise.all(nodes.map(node => 
      waitForEvent<Checkpoint>(node.chain, "finalizedCheckpoint", 240000)
    ));

    // Clean-up
    for (const node of nodes) {
      await node.stop();
    }
    for (const validator of validators) {
      await validator.stop();
    }
  });
});
