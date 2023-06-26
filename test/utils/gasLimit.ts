import { ethers } from "ethers";
import { UserOperationMiddlewareFn } from "userop";

export const mockBaseEstimateUserOperationGas =
  (provider: ethers.providers.JsonRpcProvider): UserOperationMiddlewareFn =>
  async (ctx) => {
    const [callGasLimit, verificationGasLimit, preVerificationGas] = [
      999999, 999999, 99999,
    ];
    ctx.op.preVerificationGas = preVerificationGas;
    ctx.op.verificationGasLimit = verificationGasLimit;
    ctx.op.callGasLimit = callGasLimit;
  };
