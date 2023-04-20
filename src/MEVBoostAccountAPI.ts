import { ethers, BigNumber, BigNumberish } from "ethers";
import assert from "assert";
import {
  MEVBoostAccount,
  MEVBoostAccount__factory,
  MEVBoostAccountFactory,
  MEVBoostAccountFactory__factory,
  MEVBoostPaymaster,
  MEVBoostPaymaster__factory,
} from "@mev-boost-aa/contracts";

import { TransactionDetailsForUserOp } from "./TransactionDetailsForUserOp";
import { arrayify, hexConcat } from "ethers/lib/utils";
import { Signer } from "@ethersproject/abstract-signer";
import { BaseApiParams, BaseAccountAPI } from "./BaseAccountAPI";

/**
 * constructor params, added no top of base params:
 * @param owner the signer object for the account owner
 * @param factoryAddress address of contract "factory" to deploy new contracts (not needed if account already deployed)
 * @param index nonce value used when creating multiple accounts for the same owner
 */
export interface MEVBoostAccountApiParams extends BaseApiParams {
  owner: Signer;
  mevBoostPaymasterAddress?: string;
  factoryAddress?: string;
  index?: BigNumberish;
}

/**
 * An implementation of the BaseAccountAPI using the MEVBoostAccount contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class MEVBoostAccountAPI extends BaseAccountAPI {
  private readonly mevBoostPaymasterView: MEVBoostPaymaster;

  factoryAddress?: string;
  mevBoostPaymasterAddress: string;
  owner: Signer;
  index: BigNumberish;

  /**
   * our account contract.
   * should support the "execFromEntryPoint" and "nonce" methods
   */
  accountContract?: MEVBoostAccount;
  factory?: MEVBoostAccountFactory;

  constructor(params: MEVBoostAccountApiParams) {
    super(params);
    this.factoryAddress = params.factoryAddress;
    this.owner = params.owner;
    this.index = BigNumber.from(params.index ?? 0);
    this.mevBoostPaymasterAddress = params.mevBoostPaymasterAddress!;
    this.mevBoostPaymasterView = MEVBoostPaymaster__factory.connect(
      this.mevBoostPaymasterAddress,
      params.provider
    ).connect(ethers.constants.AddressZero);
  }

  async _getAccountContract(): Promise<MEVBoostAccount> {
    if (this.accountContract == null) {
      this.accountContract = MEVBoostAccount__factory.connect(
        await this.getAccountAddress(),
        this.provider
      );
    }
    return this.accountContract;
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode(): Promise<string> {
    if (this.factory == null) {
      if (this.factoryAddress != null && this.factoryAddress !== "") {
        this.factory = MEVBoostAccountFactory__factory.connect(
          this.factoryAddress,
          this.provider
        );
      } else {
        throw new Error("no factory to get initCode");
      }
    }
    if (!this.mevBoostPaymasterAddress) {
      throw new Error("no mev boost paymaster to get initCode");
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData("createAccount", [
        await this.owner.getAddress(),
        this.mevBoostPaymasterAddress,
        this.index,
      ]),
    ]);
  }

  async getNonce(): Promise<BigNumber> {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0);
    }
    const accountContract = await this._getAccountContract();
    return await accountContract.getNonce();
  }

  async encodeExecute(
    detailsForUserOp: TransactionDetailsForUserOp
  ): Promise<string> {
    const accountContract = await this._getAccountContract();
    let { target, value, data, mevConfig } = detailsForUserOp;
    assert(target.length > 0, "empty execution target");
    if (value === undefined || value === null) {
      value = new Array<BigNumber>(target.length).fill(BigNumber.from(0));
    }
    assert(
      target.length === data.length && target.length == value.length,
      "length of target/data/value not match"
    );
    if (mevConfig) {
      return target.length === 1
        ? accountContract.interface.encodeFunctionData("boostExecute", [
            mevConfig,
            target[0],
            value[0],
            data[0],
          ])
        : accountContract.interface.encodeFunctionData("boostExecuteBatch", [
            mevConfig,
            target,
            value,
            data,
          ]);
    }

    return target.length === 1
      ? accountContract.interface.encodeFunctionData("execute", [
          target[0],
          value[0],
          data[0],
        ])
      : accountContract.interface.encodeFunctionData("executeBatch", [
          target,
          value,
          data,
        ]);
  }

  // async isBoostOp(calldata: string) {
  //   const accountContract = await this._getAccountContract();
  //   accountContract.interface.decodeFunctionData("boostExecute");
  // }

  async signUserOpHash(userOpHash: string): Promise<string> {
    return await this.owner.signMessage(arrayify(userOpHash));
  }

  async warpSuperGetUserOpReceipt(
    userOpHash: string,
    timeout = 30000,
    interval = 5000
  ) {
    await super.getUserOpReceipt(userOpHash, timeout, interval);
  }

  async selfDefinedFilter(
    userOpHash: string
  ): Promise<Array<{ transactionHash: string }>> {
    return await this.mevBoostPaymasterView.queryFilter(
      this.mevBoostPaymasterView.filters.SettleMEV(null, userOpHash)
    );
  }

  parseNumber(a: any): BigNumber | null {
    if (a == null || a === "") return null;
    return BigNumber.from(a.toString());
  }
}
