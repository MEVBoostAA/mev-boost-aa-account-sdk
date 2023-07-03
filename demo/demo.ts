import { MEVBoostAccount } from "../src/index";
import { BigNumberish, BytesLike, ethers } from "ethers";
import { Client } from "userop";

async function demo(
  signer: ethers.Signer,
  rpcUrl: string,
  mevBoostPaymaster: string,
  mevBoostAccountFactory: string,
  op: { to: string; value: BigNumberish; data: BytesLike },
  boostOp: {
    minAmount: BigNumberish;
    selfSponsoredAfter: BigNumberish;
    to: string;
    value: BigNumberish;
    data: BytesLike;
  },
  entryPoint?: string,
  overrideBundlerRpc?: string
) {
  const client = await Client.init(rpcUrl, {
    entryPoint,
    overrideBundlerRpc,
  });
  const mevBoostAccount = await MEVBoostAccount.init(signer, rpcUrl, {
    factory: mevBoostAccountFactory,
    mevBoostPaymaster,
    // `overrideBundlerRpc` is required if rpcUrl cannot provide apis of bundler
    overrideBundlerRpc,
    entryPoint,
  });

  // Case1: Normal UserOp
  // execute / executeBatch
  mevBoostAccount.executeBatch([op.to], [op.value], [op.data]);

  let res = await client.sendUserOperation(mevBoostAccount, {
    onBuild: (op) => console.log("Signed UserOperation:", op),
  });
  console.log(`UserOpHash: ${res.userOpHash}`);

  console.log("Waiting for transaction...");
  let ev = await res.wait();
  console.log(`Transaction hash: ${ev?.transactionHash ?? null}`);

  // Case2: Boost UserOp
  // boostExecute / boostExecuteBatch
  // boostOp can be executed before `selfSponsoredAfter` when searcher provides mev (>= `minAmount` wei) and userOp fee
  // boostOp can be also executed after `selfSponsoredAfter` by default
  mevBoostAccount.boostExecuteBatch(
    {
      minAmount: boostOp.minAmount,
      selfSponsoredAfter: boostOp.selfSponsoredAfter,
    },
    [boostOp.to],
    [boostOp.value],
    [boostOp.data]
  );
  res = await client.sendUserOperation(mevBoostAccount, {
    onBuild: (op) => console.log("Signed UserOperation:", op),
  });
  console.log(`UserOpHash: ${res.userOpHash}`);

  // check whether boostOp is filled
  console.log("Waiting for filled boostOp...");
  const boostOpHash = mevBoostAccount.boostOpHash(mevBoostAccount.getOp());
  const bev = await mevBoostAccount.boostWait(
    boostOpHash,
    boostOp.selfSponsoredAfter
  );
  console.log(`Transaction hash: ${bev?.transactionHash ?? null}`);

  // boostOp has not been filled
  console.log("Waiting for transaction...");
  ev = await res.wait();
  console.log(`Transaction hash: ${ev?.transactionHash ?? null}`);
}
