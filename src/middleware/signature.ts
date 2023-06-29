import { ethers } from "ethers";
import { UserOperationMiddlewareFn } from "userop";
import { isBoostOp, getBoostOpHash } from "../utils";

export const EOASignature =
  (
    provider: ethers.providers.JsonRpcProvider,
    signer: ethers.Signer
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    ctx.op.signature = await signer.signMessage(
      ethers.utils.arrayify(
        isBoostOp(provider, ctx.op) ? getBoostOpHash(ctx) : ctx.getUserOpHash()
      )
    );
  };
