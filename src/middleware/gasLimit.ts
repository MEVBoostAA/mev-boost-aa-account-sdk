import { ethers } from "ethers";
import { UserOperationMiddlewareFn, Presets } from "userop";
import { MEVBoostPaymaster } from "@mev-boost-aa/contracts";
import { isBoostOp } from "../utils";

export const estimateUserOperationGas =
  (
    provider: ethers.providers.JsonRpcProvider,
    mevBoostPaymaster: MEVBoostPaymaster,
    baseEstimate?: (
      provider: ethers.providers.JsonRpcProvider
    ) => UserOperationMiddlewareFn
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    await (baseEstimate || Presets.Middleware.estimateUserOperationGas)(
      provider
    )(ctx);

    if (!isBoostOp(provider, ctx.op)) {
      return;
    }
    // boostOp
    // TODO: Add additional preVerificationGas
    const postOpOverHead = await mevBoostPaymaster.MAX_GAS_OF_POST();
    ctx.op.verificationGasLimit = ethers.BigNumber.from(
      ctx.op.verificationGasLimit
    ).add(postOpOverHead);
  };
