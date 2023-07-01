import { ethers, BytesLike, BigNumber } from "ethers";
import {
  UserOperationMiddlewareFn,
  IUserOperationMiddlewareCtx,
  Presets,
} from "userop";
import { MEVBoostPaymaster, IMEVBoostPaymaster } from "@mev-boost-aa/contracts";
import { isBoostOp, getBoostOpHash } from "../utils";
import { MEVBoostAA } from "../constants";

const getPaymasterAndDataForEstimate = (
  ctx: IUserOperationMiddlewareCtx,
  mevBoostPaymaster: MEVBoostPaymaster
): string => {
  // make sure searcher has enough gas limit to run a filled boostOp
  // prepare paymasterAndData for estimation
  const mevPayInfo: IMEVBoostPaymaster.MEVPayInfoStruct = {
    provider: ctx.op.sender,
    boostUserOpHash: getBoostOpHash(ctx),
    amount: 0,
    requireSuccess: true,
  };
  const paymasterAndData = ethers.utils.solidityPack(
    ["address", "bytes"],
    [
      mevBoostPaymaster.address,
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address,bytes32,uint256,bool)", "bytes"],
        [
          [
            mevPayInfo.provider,
            mevPayInfo.boostUserOpHash,
            mevPayInfo.amount,
            mevPayInfo.requireSuccess,
          ],
          MEVBoostAA.MagicSignature,
        ]
      ),
    ]
  );
  return paymasterAndData;
};

const isPaymasterExist = (paymasterAndData: BytesLike): boolean => {
  const hex = ethers.utils.hexlify(paymasterAndData);
  const r = 2 + 2 * 20;
  return hex.length >= r;
};

const getCtxForEstimate = (
  ctx: IUserOperationMiddlewareCtx,
  mevBoostPaymaster: MEVBoostPaymaster
): IUserOperationMiddlewareCtx => {
  const op = {
    ...ctx.op,
    paymasterAndData: isPaymasterExist(ctx.op.paymasterAndData)
      ? ctx.op.paymasterAndData
      : getPaymasterAndDataForEstimate(ctx, mevBoostPaymaster),
    verificationGasLimit: 10e6,
    preVerificationGas: 0,
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
  };
  return { ...ctx, op };
};

export const estimateUserOperationGas =
  (
    provider: ethers.providers.JsonRpcProvider,
    mevBoostPaymaster: MEVBoostPaymaster,
    baseEstimate?: (
      provider: ethers.providers.JsonRpcProvider
    ) => UserOperationMiddlewareFn
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    const estimate =
      baseEstimate || Presets.Middleware.estimateUserOperationGas;
    if (!isBoostOp(provider, ctx.op)) {
      await estimate(provider)(ctx);
      return;
    }

    const ctxForEstimate = getCtxForEstimate(ctx, mevBoostPaymaster);
    await estimate(provider)(ctxForEstimate);
    ctx.op.callGasLimit = ctxForEstimate.op.callGasLimit;
    ctx.op.verificationGasLimit = ctxForEstimate.op.verificationGasLimit;
    ctx.op.preVerificationGas = ctxForEstimate.op.preVerificationGas;

    const postOpOverHead = await mevBoostPaymaster.MAX_GAS_OF_POST();
    if (BigNumber.from(ctx.op.verificationGasLimit).lt(postOpOverHead)) {
      ctx.op.verificationGasLimit = postOpOverHead;
    }

    ctx.op.verificationGasLimit = BigNumber.from(ctx.op.verificationGasLimit)
      .mul(115)
      .div(110);
    ctx.op.preVerificationGas = BigNumber.from(ctx.op.preVerificationGas)
      .mul(115)
      .div(110);
  };
