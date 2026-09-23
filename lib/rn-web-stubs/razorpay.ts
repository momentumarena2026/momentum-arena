/**
 * Razorpay's native checkout, which has no web build at all.
 *
 * The preview shows a captain's screen; it never takes money. If `open` is
 * ever reached here it means the preview has been made interactive, which
 * is a decision somebody should make deliberately rather than discover.
 */
const RazorpayCheckout = {
  open(): Promise<never> {
    return Promise.reject(
      new Error("[preview] the admin preview does not take payments."),
    );
  },
};
export default RazorpayCheckout;
