import {Multiaddr} from "multiaddr";
import {expect} from "chai";
import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {ENR} from "@chainsafe/discv5";
import {Method, Version, Encoding} from "../../../src/network/reqresp/types.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {formatProtocolId, parseProtocolId} from "../../../src/network/reqresp/utils/index.js";
import {createNodeJsLibp2p, isLocalMultiAddr} from "../../../src/network/index.js";
import {getCurrentAndNextFork} from "../../../src/network/forks.js";

async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({keyType: "secp256k1"});
}

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = new Multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.true;
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = new Multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.false;
  });
});

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: Method;
    version: Version;
    encoding: Encoding;
    protocolId: string;
  }[] = [
    {
      method: Method.Status,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
    {
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(formatProtocolId(method, version, encoding)).to.equal(protocolId);
    });

    it(`Should parse ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({method, version, encoding});
    });
  }
});

describe("getCurrentAndNextFork", function () {
  const altairEpoch = config.forks.altair.epoch;
  afterEach(() => {
    config.forks.altair.epoch = altairEpoch;
  });

  it("should return no next fork if altair epoch is infinity", () => {
    config.forks.altair.epoch = Infinity;
    const {currentFork, nextFork} = getCurrentAndNextFork(config, 0);
    expect(currentFork.name).to.be.equal(ForkName.phase0);
    expect(nextFork).to.be.undefined;
  });

  it("should return altair as next fork", () => {
    config.forks.altair.epoch = 1000;
    let forks = getCurrentAndNextFork(config, 0);
    expect(forks.currentFork.name).to.be.equal(ForkName.phase0);
    if (forks.nextFork) {
      expect(forks.nextFork.name).to.be.equal(ForkName.altair);
    } else {
      expect.fail("No next fork");
    }

    forks = getCurrentAndNextFork(config, 1000);
    expect(forks.currentFork.name).to.be.equal(ForkName.altair);
    expect(forks.nextFork).to.be.undefined;
  });
});

describe("createNodeJsLibp2p", () => {
  it("should extract bootMultiaddrs from enr with tcp", async function () {
    this.timeout(0);
    const peerId = await createPeerId();
    const enrWithTcp = [
      "enr:-LK4QDiPGwNomqUqNDaM3iHYvtdX7M5qngson6Qb2xGIg1LwC8-Nic0aQwO0rVbJt5xp32sRE3S1YqvVrWO7OgVNv0kBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpA7CIeVAAAgCf__________gmlkgnY0gmlwhBKNA4qJc2VjcDI1NmsxoQKbBS4ROQ_sldJm5tMgi36qm5I5exKJFb4C8dDVS_otAoN0Y3CCIyiDdWRwgiMo",
    ];
    const bootMultiaddrs: string[] = [];
    await createNodeJsLibp2p(
      peerId,
      {
        connectToDiscv5Bootnodes: true,
        discv5: {
          enabled: false,
          enr: new ENR(),
          bindAddr: "/ip4/127.0.0.1/udp/0",
          bootEnrs: enrWithTcp,
        },
        bootMultiaddrs,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
        targetPeers: defaultNetworkOptions.targetPeers,
        maxPeers: defaultNetworkOptions.maxPeers,
      },
      {disablePeerDiscovery: true}
    );
    expect(bootMultiaddrs.length).to.be.equal(1);
    expect(bootMultiaddrs[0]).to.be.equal(
      "/ip4/18.141.3.138/tcp/9000/p2p/16Uiu2HAm5rokhpCBU7yBJHhMKXZ1xSVWwUcPMrzGKvU5Y7iBkmuK"
    );
  });

  it("should not extract bootMultiaddrs from enr without tcp", async function () {
    this.timeout(0);
    const peerId = await createPeerId();
    const enrWithoutTcp = [
      "enr:-Ku4QCFQW96tEDYPjtaueW3WIh1CB0cJnvw_ibx5qIFZGqfLLj-QajMX6XwVs2d4offuspwgH3NkIMpWtCjCytVdlywGh2F0dG5ldHOIEAIAAgABAUyEZXRoMpCi7FS9AQAAAAAiAQAAAAAAgmlkgnY0gmlwhFA4VK6Jc2VjcDI1NmsxoQNGH1sJJS86-0x9T7qQewz9Wn9zlp6bYxqqrR38JQ49yIN1ZHCCIyg",
    ];
    const bootMultiaddrs: string[] = [];
    await createNodeJsLibp2p(
      peerId,
      {
        connectToDiscv5Bootnodes: true,
        discv5: {
          enabled: false,
          enr: new ENR(),
          bindAddr: "/ip4/127.0.0.1/udp/0",
          bootEnrs: enrWithoutTcp,
        },
        bootMultiaddrs,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
        targetPeers: defaultNetworkOptions.targetPeers,
        maxPeers: defaultNetworkOptions.maxPeers,
      },
      {disablePeerDiscovery: true}
    );
    expect(bootMultiaddrs.length).to.be.equal(0);
  });
});
