import {routes} from "@chainsafe/lodestar-api";
import {Epoch, ssz} from "@chainsafe/lodestar-types";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@chainsafe/lodestar-params";
import {validateGossipAttestation} from "../../../../chain/validation/index.js";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing.js";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing.js";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit.js";
import {validateSyncCommitteeSigOnly} from "../../../../chain/validation/syncCommittee.js";
import {ApiModules} from "../../types.js";
import {AttestationError, GossipAction, SyncCommitteeError} from "../../../../chain/errors/index.js";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network">): routes.beacon.pool.Api {
  return {
    async getPoolAttestations(filters) {
      // Already filtered by slot
      let attestations = chain.aggregatedAttestationPool.getAll(filters?.slot);

      if (filters?.committeeIndex !== undefined) {
        attestations = attestations.filter((attestation) => filters.committeeIndex === attestation.data.index);
      }

      return {data: attestations};
    },

    async getPoolAttesterSlashings() {
      return {data: chain.opPool.getAllAttesterSlashings()};
    },

    async getPoolProposerSlashings() {
      return {data: chain.opPool.getAllProposerSlashings()};
    },

    async getPoolVoluntaryExits() {
      return {data: chain.opPool.getAllVoluntaryExits()};
    },

    async submitPoolAttestations(attestations) {
      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];

      await Promise.all(
        attestations.map(async (attestation, i) => {
          try {
            const {indexedAttestation, subnet} = await validateGossipAttestation(chain, attestation, null);

            chain.attestationPool.add(attestation);
            const sentPeers = await network.gossip.publishBeaconAttestation(attestation, subnet);
            metrics?.submitUnaggregatedAttestation(seenTimestampSec, indexedAttestation, subnet, sentPeers);
          } catch (e) {
            errors.push(e as Error);
            logger.error(
              `Error on submitPoolAttestations [${i}]`,
              {slot: attestation.data.slot, index: attestation.data.index},
              e as Error
            );
            if (e instanceof AttestationError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.phase0.Attestation, attestation, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolAttestations\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async submitPoolAttesterSlashing(attesterSlashing) {
      await validateGossipAttesterSlashing(chain, attesterSlashing);
      chain.opPool.insertAttesterSlashing(attesterSlashing);
      await network.gossip.publishAttesterSlashing(attesterSlashing);
    },

    async submitPoolProposerSlashing(proposerSlashing) {
      await validateGossipProposerSlashing(chain, proposerSlashing);
      chain.opPool.insertProposerSlashing(proposerSlashing);
      await network.gossip.publishProposerSlashing(proposerSlashing);
    },

    async submitPoolVoluntaryExit(voluntaryExit) {
      await validateGossipVoluntaryExit(chain, voluntaryExit);
      chain.opPool.insertVoluntaryExit(voluntaryExit);
      await network.gossip.publishVoluntaryExit(voluntaryExit);
    },

    /**
     * POST `/eth/v1/beacon/pool/sync_committees`
     *
     * Submits sync committee signature objects to the node.
     * Sync committee signatures are not present in phase0, but are required for Altair networks.
     * If a sync committee signature is validated successfully the node MUST publish that sync committee signature on all applicable subnets.
     * If one or more sync committee signatures fail validation the node MUST return a 400 error with details of which sync committee signatures have failed, and why.
     *
     * https://github.com/ethereum/beacon-APIs/pull/135
     */
    async submitPoolSyncCommitteeSignatures(signatures) {
      // Fetch states for all slots of the `signatures`
      const slots = new Set<Epoch>();
      for (const signature of signatures) {
        slots.add(signature.slot);
      }

      // TODO: Fetch states at signature slots
      const state = chain.getHeadState();

      const errors: Error[] = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            const synCommittee = state.epochCtx.getIndexedSyncCommittee(signature.slot);
            const indexesInCommittee = synCommittee.validatorIndexMap.get(signature.validatorIndex);
            if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
              return; // Not a sync committee member
            }

            // Verify signature only, all other data is very likely to be correct, since the `signature` object is created by this node.
            // Worst case if `signature` is not valid, gossip peers will drop it and slightly downscore us.
            await validateSyncCommitteeSigOnly(chain, state, signature);

            await Promise.all(
              indexesInCommittee.map(async (indexInCommittee) => {
                // Sync committee subnet members are just sequential in the order they appear in SyncCommitteeIndexes array
                const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
                const indexInSubcommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
                chain.syncCommitteeMessagePool.add(subnet, signature, indexInSubcommittee);
                await network.gossip.publishSyncCommitteeSignature(signature, subnet);
              })
            );
          } catch (e) {
            errors.push(e as Error);
            logger.error(
              `Error on submitPoolSyncCommitteeSignatures [${i}]`,
              {slot: signature.slot, validatorIndex: signature.validatorIndex},
              e as Error
            );
            if (e instanceof SyncCommitteeError && e.action === GossipAction.REJECT) {
              chain.persistInvalidSszValue(ssz.altair.SyncCommitteeMessage, signature, "api_reject");
            }
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },
  };
}
