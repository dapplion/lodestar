import {expect} from "chai";
import {
  altair,
  phase0,
  CachedBeaconStatePhase0,
  BeaconStateAllForks,
  BeaconStateAltair,
  beforeProcessEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkName} from "@chainsafe/lodestar-params";
import {VectorCompositeType} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../utils/getConfig.js";
import {TestRunnerFn} from "../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

export const rewards: TestRunnerFn<any, Deltas> = (fork, testName, testSuite) => {
  switch (fork) {
    case ForkName.phase0:
      return rewardsPhase0(fork, testName, testSuite);
    default:
      return rewardsAltair(fork, testName, testSuite);
  }
};

const deltasType = new VectorCompositeType(ssz.phase0.Balances, 2);

const rewardsPhase0: TestRunnerFn<RewardTestCasePhase0, Deltas> = (fork: ForkName) => {
  return {
    testFunction: (testcase) => {
      const config = getConfig(fork);
      const wrappedState = createCachedBeaconStateTest(testcase.pre, config);
      const epochProcess = beforeProcessEpoch(wrappedState);
      return phase0.getAttestationDeltas(wrappedState as CachedBeaconStatePhase0, epochProcess);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        source_deltas: deltasType,
        target_deltas: deltasType,
        head_deltas: deltasType,
        inclusion_delay_deltas: deltasType,
        inactivity_penalty_deltas: deltasType,
      },
      timeout: 100000000,
      getExpected: (testCase) =>
        sumDeltas([
          testCase.source_deltas,
          testCase.target_deltas,
          testCase.head_deltas,
          testCase.inclusion_delay_deltas,
          testCase.inactivity_penalty_deltas,
        ]),
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.deep.equal(expected);
      },
    },
  };
};

const rewardsAltair: TestRunnerFn<RewardTestCaseAltair, Deltas> = (fork) => {
  return {
    testFunction: (testcase) => {
      const config = getConfig(fork);
      const state = createCachedBeaconStateTest(testcase.pre as BeaconStateAltair, config);
      const epochProcess = beforeProcessEpoch(state);
      // To debug this test and get granular results you can tweak inputs to get more granular results
      //
      // TIMELY_HEAD_FLAG_INDEX -> FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED
      // TIMELY_SOURCE_FLAG_INDEX -> FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED
      // TIMELY_TARGET_FLAG_INDEX -> FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED
      //
      // - To get head_deltas set TIMELY_SOURCE_FLAG_INDEX | TIMELY_TARGET_FLAG_INDEX to false
      // - To get source_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_TARGET_FLAG_INDEX to false
      // - To get target_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_SOURCE_FLAG_INDEX to false
      //   + set all inactivityScores to zero
      // - To get inactivity_penalty_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_SOURCE_FLAG_INDEX to false
      //   + set PARTICIPATION_FLAG_WEIGHTS[TIMELY_TARGET_FLAG_INDEX] to zero
      return altair.getRewardsAndPenalties(state, epochProcess);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        head_deltas: deltasType,
        source_deltas: deltasType,
        target_deltas: deltasType,
        inactivity_penalty_deltas: deltasType,
      },
      getExpected: (testCase) =>
        sumDeltas([
          testCase.head_deltas,
          testCase.source_deltas,
          testCase.target_deltas,
          testCase.inactivity_penalty_deltas,
        ]),
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.deep.equal(expected);
      },
    },
  };
};

type Deltas = [number[], number[]];

type RewardTestCasePhase0 = {
  pre: BeaconStateAllForks;
  source_deltas: Deltas;
  target_deltas: Deltas;
  head_deltas: Deltas;
  inclusion_delay_deltas: Deltas;
  inactivity_penalty_deltas: Deltas;
};

type RewardTestCaseAltair = {
  pre: BeaconStateAllForks;
  head_deltas: Deltas;
  source_deltas: Deltas;
  target_deltas: Deltas;
  inactivity_penalty_deltas: Deltas;
};

function sumDeltas(deltasArr: Deltas[]): Deltas {
  const totalDeltas: Deltas = [[], []];
  for (const deltas of deltasArr) {
    for (const n of [0, 1]) {
      for (let i = 0; i < deltas[n].length; i++) {
        totalDeltas[n][i] = (totalDeltas[n][i] ?? 0) + deltas[n][i];
      }
    }
  }
  return totalDeltas;
}
