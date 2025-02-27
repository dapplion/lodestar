import {allForks, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ForkName} from "@chainsafe/lodestar-params";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/default";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {TestRunnerFn} from "../utils/types.js";
import {getPreviousFork} from "./fork.js";

export const transition: TestRunnerFn<TransitionTestCase, BeaconStateAllForks> = (forkNext) => {
  if (forkNext === ForkName.phase0) {
    throw Error("fork phase0 not supported");
  }

  const forkPrev = getPreviousFork(config, forkNext);

  /**
   * https://github.com/ethereum/eth2.0-specs/tree/v1.1.0-alpha.5/tests/formats/transition
   */
  function generateBlocksSZZTypeMapping(meta: TransitionTestCase["meta"]): BlocksSZZTypeMapping {
    if (meta === undefined) {
      throw new Error("No meta data found");
    }
    const blocksMapping: BlocksSZZTypeMapping = {};
    // The fork_block is the index in the test data of the last block of the initial fork.
    for (let i = 0; i < meta.blocks_count; i++) {
      blocksMapping[`blocks_${i}`] =
        i <= meta.fork_block ? ssz[forkPrev].SignedBeaconBlock : ssz[forkNext].SignedBeaconBlock;
    }
    return blocksMapping;
  }

  return {
    testFunction: (testcase) => {
      const meta = testcase.meta;

      // testConfig is used here to load forkEpoch from meta.yaml
      const forkEpoch = bnToNum(meta.fork_epoch);
      const testConfig = createIChainForkConfig(getTransitionConfig(forkNext, forkEpoch));

      let state = createCachedBeaconStateTest(testcase.pre, testConfig);
      for (let i = 0; i < meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as allForks.SignedBeaconBlock;
        state = allForks.stateTransition(state, signedBlock, {
          verifyStateRoot: true,
          verifyProposer: false,
          verifySignatures: false,
        });
      }
      return state;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      getSszTypes: (meta: TransitionTestCase["meta"]) => {
        return {
          pre: ssz[forkPrev].BeaconState,
          post: ssz[forkNext].BeaconState,
          ...generateBlocksSZZTypeMapping(meta),
        };
      },
      shouldError: (testCase) => testCase.post === undefined,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(forkNext, expected, actual);
      },
    },
  };
};

/* eslint-disable @typescript-eslint/naming-convention */

function getTransitionConfig(fork: ForkName, forkEpoch: number): Partial<IChainConfig> {
  switch (fork) {
    case ForkName.phase0:
      throw Error("phase0 not allowed");
    case ForkName.altair:
      return {ALTAIR_FORK_EPOCH: forkEpoch};
    case ForkName.bellatrix:
      return {ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: forkEpoch};
  }
}

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

type TransitionTestCase = {
  [k: string]: allForks.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    post_fork: ForkName;
    fork_epoch: bigint;
    fork_block: bigint;
    blocks_count: bigint;
    bls_setting?: bigint;
  };
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
};
