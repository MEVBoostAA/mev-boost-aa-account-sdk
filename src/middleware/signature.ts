import { ethers } from "ethers";
import { UserOperationMiddlewareFn } from "userop";
import { isBoostUserOp, getBoostOpHash } from "../utils";

export const EOASignature =
  (
    provider: ethers.providers.JsonRpcProvider,
    signer: ethers.Signer
  ): UserOperationMiddlewareFn =>
  async (ctx) => {
    ctx.op.signature = await signer.signMessage(
      ethers.utils.arrayify(
        isBoostUserOp(provider, ctx) ? getBoostOpHash(ctx) : ctx.getUserOpHash()
      )
    );
  };
