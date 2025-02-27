import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {allForks, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {bellatrix, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {shouldVerify, TestRunnerFn} from "../utils/types.js";
import {getConfig} from "../utils/getConfig.js";

/* eslint-disable @typescript-eslint/naming-convention */

export const sanity: TestRunnerFn<any, BeaconStateAllForks> = (fork, testName, testSuite) => {
  switch (testName) {
    case "slots":
      return sanitySlots(fork, testName, testSuite);
    case "blocks":
      return sanityBlocks(fork, testName, testSuite);
    default:
      throw Error(`Unknown sanity test ${testName}`);
  }
};

const sanitySlots: TestRunnerFn<SanitySlotsTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const stateTB = testcase.pre.clone();
      const state = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const postState = allForks.processSlots(state, state.slot + bnToNum(testcase.slots));
      // TODO: May be part of runStateTranstion, necessary to commit again?
      postState.commit();
      return postState;
    },
    options: {
      inputTypes: {...inputTypeSszTreeViewDU, slots: InputType.YAML},
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      shouldError: (testCase) => !testCase.post,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    },
  };
};

export const sanityBlocks: TestRunnerFn<SanityBlocksTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const stateTB = testcase.pre;
      let wrappedState = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as bellatrix.SignedBeaconBlock;
        wrappedState = allForks.stateTransition(wrappedState, signedBlock, {
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
        });
      }
      return wrappedState;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 99),
      },
      shouldError: (testCase) => testCase.post === undefined,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    },
  };
};

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

export function generateBlocksSZZTypeMapping(fork: ForkName, n: number): BlocksSZZTypeMapping {
  const blocksMapping: BlocksSZZTypeMapping = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz[fork].SignedBeaconBlock;
  }
  return blocksMapping;
}

type SanityBlocksTestCase = {
  [k: string]: allForks.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
};

type SanitySlotsTestCase = {
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
  slots: bigint;
};
