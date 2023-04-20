import { BigNumberish } from "ethers";
import { IMEVBoostAccount } from "@mev-boost-aa/contracts";

export interface MEVConfig {
  minAmount: BigNumberish;
  selfSponsoredAfter: BigNumberish;
}

export interface TransactionDetailsForUserOp {
  target: string[];
  data: string[];
  value?: BigNumberish[];
  gasLimit?: BigNumberish;
  maxFeePerGas?: BigNumberish;
  maxPriorityFeePerGas?: BigNumberish;
  nonce?: BigNumberish;
  mevConfig?: IMEVBoostAccount.MEVConfigStruct;
}
