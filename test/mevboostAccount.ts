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
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("mevBoostAccount test", () => {
  const signer = ethers.provider.getSigner();
  let mevBoostAccount: MEVBoostAccount;
  let mevBoostAccountFactory: MEVBoostAccountFactory;
  let mevBoostPaymaster: MEVBoostPaymaster;
  let entryPoint: EntryPoint;
  beforeEach(async () => {
    entryPoint = await new EntryPoint__factory().connect(signer).deploy();
    signer._signTypedData;
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
    mevBoostPaymaster
      .connect(signer)
      .deposit(signer.getAddress(), { value: ethers.utils.parseEther("50") });
  });

  it("init mevboost account", async () => {
    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );
    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    const userOpHash = mevBoostAccount.userOpHash(userOp);
    await mevBoostAccount.wait(userOpHash);

    expect(await mevBoostAccount.nonce()).to.eq(1);
    expect(
      (await ethers.provider.getCode(mevBoostAccount.getSender())).length
    ).to.gt(0);
  });

  it("init mevboost account and executeBatch", async () => {
    const receiver = ethers.Wallet.createRandom();
    const value = ethers.utils.parseEther("1");

    mevBoostAccount.executeBatch([receiver.address], [value], ["0x"]);
    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );

    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    const userOpHash = mevBoostAccount.userOpHash(userOp);
    await mevBoostAccount.wait(userOpHash);

    expect(await ethers.provider.getBalance(receiver.address)).to.eq(value);
  });

  it("init mevboost account and execute", async () => {
    const receiver = ethers.Wallet.createRandom();
    const value = ethers.utils.parseEther("1");

    mevBoostAccount.execute(receiver.address, value, "0x");
    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );

    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    expect(await ethers.provider.getBalance(receiver.address)).to.eq(value);
  });

  it("init mevboost account and boostExecuteBatch success with unfilled boostOp", async () => {
    const receiver = ethers.Wallet.createRandom();
    const value = ethers.utils.parseEther("1");
    const timestamp = await mevBoostAccount.blockTimeStamp();
    const selfSponsoredAfter = timestamp + 3600;
    mevBoostAccount.boostExecuteBatch(
      { minAmount: 0, selfSponsoredAfter },
      [receiver.address],
      [value],
      ["0x"]
    );

    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );

    await time.increaseTo(selfSponsoredAfter);

    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    expect(await ethers.provider.getBalance(receiver.address)).to.eq(value);
  });

  it("init mevboost account and boostExecuteBatch fail with unfilled boostOp", async () => {
    const receiver = ethers.Wallet.createRandom();
    const value = ethers.utils.parseEther("1");
    const timestamp = await mevBoostAccount.blockTimeStamp();
    const selfSponsoredAfter = timestamp + 3600;
    mevBoostAccount.boostExecuteBatch(
      { minAmount: 0, selfSponsoredAfter },
      [receiver.address],
      [value],
      ["0x"]
    );

    const userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );
    await expect(
      entryPoint.connect(signer).handleOps([userOp], signer.getAddress())
    ).to.be.reverted;
  });

  it("init mevboost account and boostExecuteBatch suceess with filled boostOp", async () => {
    const receiver = ethers.Wallet.createRandom();
    const value = ethers.utils.parseEther("1");
    const timestamp = await mevBoostAccount.blockTimeStamp();
    const selfSponsoredAfter = timestamp + 3600;
    mevBoostAccount.boostExecuteBatch(
      { minAmount: ethers.utils.parseEther("1"), selfSponsoredAfter },
      [receiver.address],
      [value],
      ["0x"]
    );

    let userOp = await mevBoostAccount.buildOp(
      entryPoint.address,
      ethers.provider.network.chainId
    );

    userOp = await mevBoostAccount.fillBoostOp();

    await entryPoint.connect(signer).handleOps([userOp], signer.getAddress());

    await mevBoostAccount.boostWait(mevBoostAccount.boostOpHash(userOp));
  });
});
