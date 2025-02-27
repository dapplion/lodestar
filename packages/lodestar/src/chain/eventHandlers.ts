import {toHexString} from "@chainsafe/ssz";
import {allForks, Epoch, phase0, Slot, Version} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CheckpointWithHex, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {AttestationError, BlockError, BlockErrorCode} from "./errors/index.js";
import {ChainEvent, IChainEvents} from "./emitter.js";
import {BeaconChain} from "./chain.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "./reprocess.js";
import {toCheckpointHex} from "./stateCache/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCallback = () => Promise<void>;

/**
 * Returns a function that runs an async handler function with input args,
 * If the handler function successfully completes,
 * then emits the event on the event emitter using the same args
 */
function wrapHandler<
  Event extends keyof IChainEvents = keyof IChainEvents,
  Callback extends IChainEvents[Event] = IChainEvents[Event]
>(event: Event, logger: ILogger, handler: (...args: Parameters<Callback>) => Promise<void> | void) {
  return async (...args: Parameters<Callback>): Promise<void> => {
    try {
      await handler(...args);
    } catch (e) {
      logger.error("Error handling event", {event}, e as Error);
    }
  };
}

/**
 * Attach ChainEventEmitter event handlers
 * Listen on `signal` to remove event handlers
 */
export function handleChainEvents(this: BeaconChain, signal: AbortSignal): void {
  const handlersObj: {
    [K in keyof IChainEvents]: IChainEvents[K];
  } = {
    [ChainEvent.attestation]: onAttestation,
    [ChainEvent.block]: onBlock,
    [ChainEvent.checkpoint]: onCheckpoint,
    [ChainEvent.clockEpoch]: onClockEpoch,
    [ChainEvent.clockSlot]: onClockSlot,
    [ChainEvent.errorAttestation]: onErrorAttestation,
    [ChainEvent.errorBlock]: onErrorBlock,
    [ChainEvent.finalized]: onFinalized,
    [ChainEvent.forkChoiceFinalized]: onForkChoiceFinalized,
    [ChainEvent.forkChoiceHead]: onForkChoiceHead,
    [ChainEvent.forkChoiceJustified]: onForkChoiceJustified,
    [ChainEvent.forkChoiceReorg]: onForkChoiceReorg,
    [ChainEvent.justified]: onJustified,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    [ChainEvent.lightclientHeaderUpdate]: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    [ChainEvent.lightclientFinalizedUpdate]: () => {},
  };

  const emitter = this.emitter;
  const logger = this.logger;
  const onAbort: (() => void)[] = [];

  for (const [eventStr, handler] of Object.entries(handlersObj)) {
    const event = eventStr as ChainEvent;
    const wrappedHandler = wrapHandler(event, logger, handler.bind(this) as AnyCallback) as AnyCallback;
    emitter.on(event, wrappedHandler);
    onAbort.push(() => emitter.off(event, wrappedHandler));
  }

  signal.addEventListener(
    "abort",
    () => {
      for (const fn of onAbort) fn();
    },
    {once: true}
  );
}

export async function onClockSlot(this: BeaconChain, slot: Slot): Promise<void> {
  this.logger.verbose("Clock slot", {slot});

  // CRITICAL UPDATE
  this.forkChoice.updateTime(slot);

  this.metrics?.clockSlot.set(slot);

  this.attestationPool.prune(slot);
  this.aggregatedAttestationPool.prune(slot);
  this.syncCommitteeMessagePool.prune(slot);
  this.seenSyncCommitteeMessages.prune(slot);
  this.reprocessController.onSlot(slot);
}

export function onClockEpoch(this: BeaconChain, currentEpoch: Epoch): void {
  this.seenAttesters.prune(currentEpoch);
  this.seenAggregators.prune(currentEpoch);
  this.seenAggregatedAttestations.prune(currentEpoch);
  this.beaconProposerCache.prune(currentEpoch);
}

export function onForkVersion(this: BeaconChain, version: Version): void {
  this.logger.verbose("New fork version", toHexString(version));
}

export function onCheckpoint(this: BeaconChain, cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void {
  this.logger.verbose("Checkpoint processed", toCheckpointHex(cp));

  this.metrics?.currentValidators.set({status: "active"}, state.epochCtx.currentShuffling.activeIndices.length);
  const parentBlockSummary = this.forkChoice.getBlock(state.latestBlockHeader.parentRoot);

  if (parentBlockSummary) {
    const justifiedCheckpoint = state.currentJustifiedCheckpoint;
    const justifiedEpoch = justifiedCheckpoint.epoch;
    const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
    if (justifiedEpoch > preJustifiedEpoch) {
      this.emitter.emit(ChainEvent.justified, justifiedCheckpoint, state);
    }
    const finalizedCheckpoint = state.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
    if (finalizedEpoch > preFinalizedEpoch) {
      this.emitter.emit(ChainEvent.finalized, finalizedCheckpoint, state);
    }
  }
}

export function onJustified(this: BeaconChain, cp: phase0.Checkpoint, state: CachedBeaconStateAllForks): void {
  this.logger.verbose("Checkpoint justified", toCheckpointHex(cp));
  this.metrics?.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  this.metrics?.currentJustifiedEpoch.set(cp.epoch);
}

export async function onFinalized(this: BeaconChain, cp: phase0.Checkpoint): Promise<void> {
  this.logger.verbose("Checkpoint finalized", toCheckpointHex(cp));
  this.metrics?.finalizedEpoch.set(cp.epoch);
}

export function onForkChoiceJustified(this: BeaconChain, cp: CheckpointWithHex): void {
  this.logger.verbose("Fork choice justified", {epoch: cp.epoch, root: cp.rootHex});
}

export async function onForkChoiceFinalized(this: BeaconChain, cp: CheckpointWithHex): Promise<void> {
  this.logger.verbose("Fork choice finalized", {epoch: cp.epoch, root: cp.rootHex});
  this.seenBlockProposers.prune(computeStartSlotAtEpoch(cp.epoch));

  // TODO: Improve using regen here
  const headState = this.stateCache.get(this.forkChoice.getHead().stateRoot);
  if (headState) {
    this.opPool.pruneAll(headState);
  }
}

export function onForkChoiceHead(this: BeaconChain, head: IProtoBlock): void {
  const delaySec = this.clock.secFromSlot(head.slot);
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: head.blockRoot,
    delaySec,
  });
  this.syncContributionAndProofPool.prune(head.slot);
  this.seenContributionAndProof.prune(head.slot);

  if (this.metrics) {
    this.metrics.headSlot.set(head.slot);
    // Only track "recent" blocks. Otherwise sync can distort this metrics heavily.
    // We want to track recent blocks coming from gossip, unknown block sync, and API.
    if (delaySec < 64 * this.config.SECONDS_PER_SLOT) {
      this.metrics.elapsedTimeTillBecomeHead.observe(delaySec);
    }
  }
}

export function onForkChoiceReorg(this: BeaconChain, head: IProtoBlock, oldHead: IProtoBlock, depth: number): void {
  this.logger.verbose("Chain reorg", {
    depth,
    previousHead: oldHead.blockRoot,
    previousHeadParent: oldHead.parentRoot,
    previousSlot: oldHead.slot,
    newHead: head.blockRoot,
    newHeadParent: head.parentRoot,
    newSlot: head.slot,
  });
}

export function onAttestation(this: BeaconChain, _: phase0.Attestation): void {
  // don't want to log the processed attestations here as there are so many attestations and it takes too much disc space,
  // users may want to keep more log files instead of unnecessary processed attestations log
  // see https://github.com/ChainSafe/lodestar/pull/4032
}

export async function onBlock(
  this: BeaconChain,
  block: allForks.SignedBeaconBlock,
  _postState: CachedBeaconStateAllForks
): Promise<void> {
  const blockRoot = toHexString(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  const advancedSlot = this.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  this.reprocessController.onBlockImported({slot: block.message.slot, root: blockRoot}, advancedSlot);

  this.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: blockRoot,
    delaySec: this.clock.secFromSlot(block.message.slot),
  });
}

export async function onErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received", {}, err);
    return;
  }

  this.logger.debug("Attestation error", {}, err);
}

export async function onErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received", {}, err);
    return;
  }

  // err type data may contain CachedBeaconState which is too much to log
  const slimError = new Error();
  slimError.message = err.message;
  slimError.stack = err.stack;
  this.logger.error("Block error", {slot: err.signedBlock.message.slot, errCode: err.type.code}, err);

  if (err.type.code === BlockErrorCode.INVALID_SIGNATURE) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {state} = err.type;
    const forkTypes = this.config.getForkTypes(blockSlot);
    this.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, `${blockSlot}_invalid_signature`);
    this.persistInvalidSszView(state, `${state.slot}_invalid_signature`);
  } else if (err.type.code === BlockErrorCode.INVALID_STATE_ROOT) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {preState, postState} = err.type;
    const forkTypes = this.config.getForkTypes(blockSlot);
    const invalidRoot = toHexString(postState.hashTreeRoot());

    const suffix = `slot_${blockSlot}_invalid_state_root_${invalidRoot}`;
    this.persistInvalidSszValue(forkTypes.SignedBeaconBlock, signedBlock, suffix);
    this.persistInvalidSszView(preState, `${suffix}_preState`);
    this.persistInvalidSszView(postState, `${suffix}_postState`);
  }
}
