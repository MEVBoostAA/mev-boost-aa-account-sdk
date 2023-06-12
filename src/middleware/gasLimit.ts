import { ethers } from "ethers";
import { hexlify, arrayify } from "ethers/lib/utils";
import { UserOperationMiddlewareFn, Presets } from "userop";
import {
  MEVBoostAccount__factory,
  MEVBoostPaymaster__factory,
} from "@mev-boost-aa/contracts";

export const estimateUserOperationGas =
  (provider: ethers.providers.JsonRpcProvider): UserOperationMiddlewareFn =>
  async (ctx) => {
    await Presets.Middleware.estimateUserOperationGas(provider)(ctx);
    const selector = hexlify(arrayify(ctx.op.callData).slice(0, 4));
    const proxy = MEVBoostAccount__factory.connect(ctx.op.sender, provider);
    if (
      selector !==
        proxy.interface.getSighash(
          proxy.interface.getFunction("boostExecute")
        ) ||
      selector !==
        proxy.interface.getSighash(
          proxy.interface.getFunction("boostExecuteBatch")
        )
    ) {
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
