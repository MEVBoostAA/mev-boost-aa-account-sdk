import { ethers } from "ethers";
import { UserOperationMiddlewareFn } from "userop";
import { isBoostOp, getBoostOpHash } from "../utils";

export const EOASignature =
  (
    provider: ethers.providers.JsonRpcProvider,
    signer: ethers.Signer
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    const hash = isBoostOp(provider, ctx.op)
      ? getBoostOpHash(ctx)
      : ctx.getUserOpHash();
    ctx.op.signature = await signer.signMessage(ethers.utils.arrayify(hash));
  };
