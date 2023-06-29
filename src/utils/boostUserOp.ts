import { ethers } from "ethers";
import { hexlify, arrayify } from "ethers/lib/utils";
import { IUserOperationMiddlewareCtx, IUserOperation } from "userop";
import {
  MEVBoostAccount__factory,
  IMEVBoostAccount,
} from "@mev-boost-aa/contracts";

export const getBoostOpInfo = (
  provider: ethers.providers.JsonRpcProvider,
  op: IUserOperation
): {
  selector: string;
  func: string;
  mevConfig: IMEVBoostAccount.MEVConfigStruct;
} => {
  const selector = hexlify(arrayify(op.callData).slice(0, 4));
  const proxy = MEVBoostAccount__factory.connect(op.sender, provider);
  if (
    selector ===
    proxy.interface.getSighash(proxy.interface.getFunction("boostExecute"))
  ) {
    const mevConfig: IMEVBoostAccount.MEVConfigStruct =
      proxy.interface.decodeFunctionData("boostExecute", op.callData)[0];
    return { selector, func: "boostExecute", mevConfig };
  }
  if (
    selector ===
    proxy.interface.getSighash(proxy.interface.getFunction("boostExecuteBatch"))
  ) {
    const mevConfig: IMEVBoostAccount.MEVConfigStruct =
      proxy.interface.decodeFunctionData("boostExecuteBatch", op.callData)[0];
    return { selector, func: "boostExecuteBatch", mevConfig };
  }
  throw new Error("Not a boost userOp");
};

export const isBoostOp = (
  provider: ethers.providers.JsonRpcProvider,
  op: IUserOperation
): boolean => {
  const selector = hexlify(arrayify(op.callData).slice(0, 4));
  const proxy = MEVBoostAccount__factory.connect(op.sender, provider);
  return (
    selector ===
      proxy.interface.getSighash(proxy.interface.getFunction("boostExecute")) ||
    selector ===
      proxy.interface.getSighash(
        proxy.interface.getFunction("boostExecuteBatch")
      )
  );
};

export const getBoostOpHash = (ctx: IUserOperationMiddlewareCtx): string => {
  const packed = ethers.utils.defaultAbiCoder.encode(
    [
      "address",
      "uint256",
      "bytes32",
      "bytes32",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "bytes32",
    ],
    [
      ctx.op.sender,
      ctx.op.nonce,
      ethers.utils.keccak256(ctx.op.initCode),
      ethers.utils.keccak256(ctx.op.callData),
      ctx.op.callGasLimit,
      ctx.op.verificationGasLimit,
      ctx.op.preVerificationGas,
      ctx.op.maxFeePerGas,
      ctx.op.maxPriorityFeePerGas,
      ethers.utils.keccak256("0x"),
    ]
  );

  const enc = ethers.utils.defaultAbiCoder.encode(
    ["bytes32", "address", "uint256"],
    [ethers.utils.keccak256(packed), ctx.entryPoint, ctx.chainId]
  );

  return ethers.utils.keccak256(enc);
};
