import { BigNumberish, BytesLike, ethers } from "ethers";
import { resolveProperties } from "ethers/lib/utils";
import { Utils, UserOperationMiddlewareFn, IUserOperation } from "userop";
import {
  MEVBoostAccount__factory,
  IMEVBoostAccount,
  MEVBoostPaymaster__factory,
} from "@mev-boost-aa/contracts";

interface GasEstimate {
  preVerificationGas: BigNumberish;
  verificationGas: BigNumberish;
  callGasLimit: BigNumberish;
}

const estimateCreationGas = async (
  provider: ethers.providers.JsonRpcProvider,
  initCode: BytesLike
): Promise<ethers.BigNumber> => {
  const initCodeHex = ethers.utils.hexlify(initCode);
  const factory = initCodeHex.substring(0, 42);
  const callData = "0x" + initCodeHex.substring(42);
  return await provider.estimateGas({
    to: factory,
    data: callData,
  });
};

const handleBoostExecute = async (
  provider: ethers.providers.JsonRpcProvider,
  copyOp: IUserOperation
): Promise<BigNumberish> => {
  const proxy = MEVBoostAccount__factory.connect(copyOp.sender, provider);

  const { mevConfig, dest, value, func } = proxy.interface.decodeFunctionData(
    "boostExecute",
    copyOp.callData
  );
  const config = await resolveProperties(
    mevConfig as IMEVBoostAccount.MEVConfigStruct
  );
  config.selfSponsoredAfter = 0;
  copyOp.callData = proxy.interface.encodeFunctionData("boostExecute", [
    config,
    dest,
    value,
    func,
  ]);
  const mevBoostPaymaster = MEVBoostPaymaster__factory.connect(
    await proxy.mevBoostPaymaster(),
    provider
  );
  const postOpOverHead = await mevBoostPaymaster.MAX_GAS_OF_POST();
  return postOpOverHead;
};

const handleBoostExecuteBatch = async (
  provider: ethers.providers.JsonRpcProvider,
  copyOp: IUserOperation
): Promise<BigNumberish> => {
  const proxy = MEVBoostAccount__factory.connect(copyOp.sender, provider);

  const { mevConfig, dest, value, func } = proxy.interface.decodeFunctionData(
    "boostExecuteBatch",
    copyOp.callData
  );
  const config = await resolveProperties(
    mevConfig as IMEVBoostAccount.MEVConfigStruct
  );
  config.selfSponsoredAfter = 0;
  copyOp.callData = proxy.interface.encodeFunctionData("boostExecuteBatch", [
    config,
    dest,
    value,
    func,
  ]);
  const mevBoostPaymaster = MEVBoostPaymaster__factory.connect(
    await proxy.mevBoostPaymaster(),
    provider
  );
  const postOpOverHead = await mevBoostPaymaster.MAX_GAS_OF_POST();
  return postOpOverHead;
};

export const estimateUserOperationGas =
  (provider: ethers.providers.JsonRpcProvider): UserOperationMiddlewareFn =>
  async (ctx) => {
    if (ethers.BigNumber.from(ctx.op.nonce).isZero()) {
      ctx.op.verificationGasLimit = ethers.BigNumber.from(
        ctx.op.verificationGasLimit
      ).add(await estimateCreationGas(provider, ctx.op.initCode));
    }
    const simulateOp = { ...ctx.op };
    let postOpOverHead: BigNumberish = ethers.BigNumber.from(0);
    try {
      postOpOverHead = await handleBoostExecute(provider, simulateOp);
    } catch {
      try {
        postOpOverHead = await handleBoostExecuteBatch(provider, simulateOp);
      } catch {}
    }

    const est = (await provider.send("eth_estimateUserOperationGas", [
      Utils.OpToJSON(simulateOp),
      ctx.entryPoint,
    ])) as GasEstimate;

    ctx.op.preVerificationGas = est.preVerificationGas;
    ctx.op.verificationGasLimit = ethers.BigNumber.from(
      est.verificationGas
    ).add(postOpOverHead);
    ctx.op.callGasLimit = est.callGasLimit;
  };
