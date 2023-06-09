import { BigNumber, BigNumberish, BytesLike, ethers } from "ethers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import {
  Constants,
  UserOperationBuilder,
  BundlerJsonRpcProvider,
  Presets,
  IPresetBuilderOpts,
  UserOperationMiddlewareFn,
  IUserOperation,
  UserOperationMiddlewareCtx,
} from "userop";
import {
  MEVBoostAccountFactory,
  MEVBoostAccount__factory,
  IMEVBoostAccount,
  MEVBoostAccount as MEVBoostAccountImpl,
  MEVBoostAccountFactory__factory,
  MEVBoostPaymaster,
  MEVBoostPaymaster__factory,
  IMEVBoostPaymaster,
} from "@mev-boost-aa/contracts";
import {
  EntryPoint,
  EntryPoint__factory,
} from "@account-abstraction/contracts";
import { MEVBoostAA } from "./constants";
import { getBoostOpHash, isBoostOp, getBoostOpInfo } from "./utils";
import { estimateUserOperationGas, EOASignature } from "./middleware";

export interface IMEVBoostAccountBuilderOpts extends IPresetBuilderOpts {
  mevBoostPaymaster?: string;
  baseEstimateUserOpGas?: (
    provider: ethers.providers.JsonRpcProvider
  ) => UserOperationMiddlewareFn;
}

export class MEVBoostAccount extends UserOperationBuilder {
  private signer: ethers.Signer;
  private provider: ethers.providers.JsonRpcProvider;
  private initCode: string;
  private proxy: MEVBoostAccountImpl;
  readonly entryPoint: EntryPoint;
  readonly factory: MEVBoostAccountFactory;
  readonly mevBoostPaymaster: MEVBoostPaymaster;

  private constructor(
    signer: ethers.Signer,
    rpcUrlOrProvider: string | ethers.providers.JsonRpcProvider,
    opts?: IMEVBoostAccountBuilderOpts
  ) {
    super();
    this.signer = signer;
    this.provider =
      typeof rpcUrlOrProvider == "string"
        ? new BundlerJsonRpcProvider(rpcUrlOrProvider).setBundlerRpc(
            opts?.overrideBundlerRpc
          )
        : rpcUrlOrProvider;
    this.entryPoint = EntryPoint__factory.connect(
      opts?.entryPoint || Constants.ERC4337.EntryPoint,
      this.provider
    );
    this.factory = MEVBoostAccountFactory__factory.connect(
      opts?.factory || MEVBoostAA.Factory,
      this.provider
    );
    this.initCode = "0x";
    this.proxy = MEVBoostAccount__factory.connect(
      ethers.constants.AddressZero,
      this.provider
    );

    this.mevBoostPaymaster = MEVBoostPaymaster__factory.connect(
      opts?.mevBoostPaymaster || MEVBoostAA.MEVBoostPaymaster,
      this.provider
    );
  }

  private resolveAccount: UserOperationMiddlewareFn = async (ctx) => {
    ctx.op.nonce = await this.entryPoint.getNonce(ctx.op.sender, 0);
    ctx.op.initCode = ctx.op.nonce.eq(0) ? this.initCode : "0x";
  };

  public static async init(
    signer: ethers.Signer,
    rpcUrlOrProvider: string | ethers.providers.JsonRpcProvider,
    opts?: IMEVBoostAccountBuilderOpts
  ): Promise<MEVBoostAccount> {
    const instance = new MEVBoostAccount(signer, rpcUrlOrProvider, opts);

    try {
      instance.initCode = await ethers.utils.hexConcat([
        instance.factory.address,
        instance.factory.interface.encodeFunctionData("createAccount", [
          await instance.signer.getAddress(),
          instance.mevBoostPaymaster.address,
          ethers.BigNumber.from(0),
        ]),
      ]);

      await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);

      throw new Error("getSenderAddress: unexpected result");
    } catch (error: any) {
      const addr = error?.errorArgs?.sender;
      if (!addr) throw error;

      instance.proxy = MEVBoostAccount__factory.connect(
        addr,
        instance.provider
      );
    }

    const base = instance
      .useDefaults({
        sender: instance.proxy.address,
        signature: MEVBoostAA.MagicSignature,
      })
      .useMiddleware(instance.resolveAccount)
      .useMiddleware(Presets.Middleware.getGasPrice(instance.provider));

    const withPM = opts?.paymasterMiddleware
      ? base.useMiddleware(opts.paymasterMiddleware)
      : base.useMiddleware(
          estimateUserOperationGas(
            instance.provider,
            instance.mevBoostPaymaster,
            opts?.baseEstimateUserOpGas
          )
        );

    return withPM.useMiddleware(
      EOASignature(instance.provider, instance.signer)
    );
  }

  async nonce() {
    return await this.proxy.getNonce();
  }

  execute(to: string, value: BigNumberish, data: BytesLike) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("execute", [to, value, data])
    );
  }

  executeBatch(
    to: Array<string>,
    value: Array<BigNumberish>,
    data: Array<BytesLike>
  ) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("executeBatch", [to, value, data])
    );
  }

  boostExecute(
    config: IMEVBoostAccount.MEVConfigStruct,
    to: string,
    value: BigNumberish,
    data: BytesLike
  ) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("boostExecute", [
        config,
        to,
        value,
        data,
      ])
    );
  }

  boostExecuteBatch(
    config: IMEVBoostAccount.MEVConfigStruct,
    to: Array<string>,
    value: Array<BigNumberish>,
    data: Array<BytesLike>
  ) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("boostExecuteBatch", [
        config,
        to,
        value,
        data,
      ])
    );
  }

  async signMevPayInfo(mevPayInfo: IMEVBoostPaymaster.MEVPayInfoStructOutput) {
    // All properties on a domain are optional
    const domain = {
      name: "MEVBoostPaymaster",
      version: "v0",
      chainId: this.provider.network.chainId,
      verifyingContract: this.mevBoostPaymaster.address,
    };

    // The named list of all type definitions
    const types = {
      MEVPayInfo: [
        { name: "provider", type: "address" },
        { name: "boostUserOpHash", type: "bytes32" },
        { name: "amount", type: "uint256" },
        { name: "requireSuccess", type: "bool" },
      ],
    };

    return await (this.signer as unknown as TypedDataSigner)._signTypedData(
      domain,
      types,
      mevPayInfo
    );
  }

  async fillBoostOp(requireSuccess: boolean = true, fillAmount?: BigNumberish) {
    const userOp = this.getOp();
    const searcher = await this.signer.getAddress();
    const { mevConfig } = this.getBoostOpInfo(userOp);

    if (
      ethers.BigNumber.from(mevConfig.selfSponsoredAfter).lt(
        await this.blockTimeStamp()
      )
    ) {
      throw "do not need to fill";
    }

    const { mevPayInfo } = await this.mevBoostPaymaster.getMEVPayInfo(
      searcher,
      requireSuccess,
      userOp
    );

    fillAmount = fillAmount ?? mevPayInfo.amount;

    if (
      BigNumber.from(fillAmount).gt(
        await this.mevBoostPaymaster.balances(searcher)
      )
    ) {
      throw "not enought balance to fill";
    }

    const signature = await this.signMevPayInfo(mevPayInfo);

    const paymasterAndData = ethers.utils.solidityPack(
      ["address", "bytes"],
      [
        this.mevBoostPaymaster.address,
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,bytes32,uint256,bool)", "bytes"],
          [
            [
              mevPayInfo.provider,
              mevPayInfo.boostUserOpHash,
              fillAmount,
              requireSuccess,
            ],
            signature,
          ]
        ),
      ]
    );
    userOp.paymasterAndData = paymasterAndData;
    return userOp;
  }

  async owner() {
    if ((await this.nonce()).eq(0)) {
      return this.signer.getAddress();
    }
    return this.proxy.owner();
  }

  userOpHash(op: IUserOperation) {
    return new UserOperationMiddlewareCtx(
      op,
      this.entryPoint.address,
      this.provider.network.chainId
    ).getUserOpHash();
  }

  boostOpHash(op: IUserOperation) {
    return getBoostOpHash(
      new UserOperationMiddlewareCtx(
        op,
        this.entryPoint.address,
        this.provider.network.chainId
      )
    );
  }

  isBoostOp(op: IUserOperation) {
    return isBoostOp(this.provider, op);
  }

  getBoostOpInfo(op: IUserOperation) {
    return getBoostOpInfo(this.provider, op);
  }

  async blockTimeStamp() {
    const latestBlock = await this.provider.getBlock("latest");
    return latestBlock.timestamp;
  }

  async wait(
    userOpHash: string,
    waitTimeoutMs: number = 30000,
    waitIntervalMs: number = 5000
  ) {
    const end = Date.now() + waitTimeoutMs;
    const block = await this.provider.getBlock("latest");
    while (Date.now() < end) {
      const events = await this.entryPoint.queryFilter(
        this.entryPoint.filters.UserOperationEvent(userOpHash),
        Math.max(0, block.number - 100)
      );
      if (events.length > 0) {
        return events[0];
      }
      await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
    }

    return null;
  }

  async boostWait(
    boostOpHash: string,
    deadlineSecond?: BigNumberish,
    waitIntervalMs: number = 5000
  ) {
    let end = Date.now() + 30000;
    if (deadlineSecond) {
      end = BigNumber.from(deadlineSecond).toNumber();
    }
    const block = await this.provider.getBlock("latest");
    while (Date.now() < end) {
      const events = await this.mevBoostPaymaster.queryFilter(
        this.mevBoostPaymaster.filters.SettleUserOp(null, boostOpHash),
        Math.max(0, block.number - 100)
      );
      if (events.length > 0) {
        return events[0];
      }
      await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
    }

    return null;
  }
}
