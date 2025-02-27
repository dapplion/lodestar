import {allForks, phase0, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {createIChainForkConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {TestRunnerFn} from "../utils/types.js";

export const fork: TestRunnerFn<ForkStateCase, BeaconStateAllForks> = (forkNext) => {
  if (forkNext === ForkName.phase0) {
    throw Error("fork phase0 not supported");
  }

  const config = createIChainForkConfig({});
  const forkPrev = getPreviousFork(config, forkNext);

  return {
    testFunction: (testcase) => {
      const preState = createCachedBeaconStateTest(testcase.pre, config);
      return allForks.upgradeStateByFork[forkNext](preState);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[forkPrev].BeaconState,
        post: ssz[forkNext].BeaconState,
      },

      timeout: 10000,
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(forkNext, expected, actual);
      },
    },
  };
};

type ForkStateCase = {
  pre: BeaconStateAllForks;
  post: Exclude<BeaconStateAllForks, phase0.BeaconState>;
};

export function getPreviousFork(config: IChainForkConfig, fork: ForkName): ForkName {
  // Find the previous fork
  const forkIndex = config.forksAscendingEpochOrder.findIndex((f) => f.name === fork);
  if (forkIndex < 1) {
    throw Error(`Fork ${fork} not found`);
  }
  return config.forksAscendingEpochOrder[forkIndex - 1].name;
}
