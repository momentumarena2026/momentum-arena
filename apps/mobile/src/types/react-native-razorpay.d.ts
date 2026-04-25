/**
 * Ambient declaration for `react-native-razorpay` — the package ships JS only,
 * but its `src/types.ts` has usable types we re-export here.
 */
declare module "react-native-razorpay" {
  import type {
    ExternalWalletData,
    PaymentErrorData,
    PaymentSuccessData,
    RazorpayOptions,
  } from "react-native-razorpay/src/types";

  class RazorpayCheckout {
    static open(
      options: RazorpayOptions,
      successCallback?: (data: PaymentSuccessData) => void,
      errorCallback?: (err: PaymentErrorData) => void
    ): Promise<PaymentSuccessData>;
    static onExternalWalletSelection(
      cb: (data: ExternalWalletData) => void
    ): void;
  }

  export default RazorpayCheckout;
  export type {
    ExternalWalletData,
    PaymentErrorData,
    PaymentSuccessData,
    RazorpayOptions,
  } from "react-native-razorpay/src/types";
}
