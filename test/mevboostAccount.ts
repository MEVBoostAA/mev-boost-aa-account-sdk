import { ethers } from "hardhat";
import { expect } from "chai";
import {
  EntryPoint__factory,
  EntryPoint,
} from "@account-abstraction/contracts";
import { MEVBoostAccount } from "../src";
import { mockBaseEstimateUserOperationGas } from "./utils";
import {
  MEVBoostAccountFactory,
  MEVBoostAccountFactory__factory,
  MEVBoostPaymaster,
  MEVBoostPaymaster__factory,
} from "@mev-boost-aa/contracts";

describe("mevBoostAccount test", () => {
  const signer = ethers.provider.getSigner();
  let mevBoostAccount: MEVBoostAccount;
  let mevBoostAccountFactory: MEVBoostAccountFactory;
  let mevBoostPaymaster: MEVBoostPaymaster;
  let entryPoint: EntryPoint;
  beforeEach(async () => {
    entryPoint = await new EntryPoint__factory().connect(signer).deploy();
    mevBoostAccountFactory = await new MEVBoostAccountFactory__factory()
      .connect(signer)
      .deploy(entryPoint.address);
    mevBoostPaymaster = await new MEVBoostPaymaster__factory()
      .connect(signer)
      .deploy(entryPoint.address);
    mevBoostAccount = await MEVBoostAccount.init(signer, ethers.provider, {
      entryPoint: entryPoint.address,
      factory: mevBoostAccountFactory.address,
      baseEstimateUserOpGas: mockBaseEstimateUserOperationGas,
      mevBoostPaymaster: mevBoostPaymaster.address,
    });
    const value = ethers.utils.parseEther("100");
    await signer.sendTransaction({
      to: mevBoostAccount.getSender(),
      value,
    });
    expect(await ethers.provider.getBalance(mevBoostAccount.getSender())).to.eq(
      value
    );
  });

  it("init mevboost account", async () => {
    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );
    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    expect(await mevBoostAccount.nonce()).to.eq(1);

    expect(
      (await ethers.provider.getCode(mevBoostAccount.getSender())).length
    ).to.gt(0);
  });
});
