import { ethers } from "ethers";
import { UserOperationMiddlewareFn, Presets } from "userop";
import {
  MEVBoostAccount__factory,
  MEVBoostPaymaster__factory,
} from "@mev-boost-aa/contracts";
import { isBoostOp } from "../utils";

export const estimateUserOperationGas =
  (
    provider: ethers.providers.JsonRpcProvider,
    baseEstimate?: (
      provider: ethers.providers.JsonRpcProvider
    ) => UserOperationMiddlewareFn
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    await (baseEstimate || Presets.Middleware.estimateUserOperationGas)(
      provider
    )(ctx);

    const proxy = MEVBoostAccount__factory.connect(ctx.op.sender, provider);
    if (!isBoostOp(provider, ctx.op)) {
      return;
    }
    const mevBoostPaymaster = MEVBoostPaymaster__factory.connect(
      await proxy.mevBoostPaymaster(),
      provider
    );
    const postOpOverHead = await mevBoostPaymaster.MAX_GAS_OF_POST();
    ctx.op.verificationGasLimit = ethers.BigNumber.from(
      ctx.op.verificationGasLimit
    ).add(postOpOverHead);
  };
