import { stubRazorpayOrders, sign, payId, ensureUser, poster, makeChallenge, snapshot, events } from "./harness";
stubRazorpayOrders();
import { createChallengePaymentOrder, confirmChallengePayment, challengeQuote } from "@/lib/challenge-payments";
import { db } from "@/lib/db";

(async () => {
  const A = await poster(1);
  const B = await ensureUser(2, "QA Captain B");
  console.log("users", A.id, B.id);

  const c = await makeChallenge({ poster: A, date: "2026-09-30", startHour: 18, endHour: 19 });
  console.log("challenge", c.id, "window", c.windows[0].id);

  // What the app shows a stranger for this window.
  const qB = await challengeQuote(c.id, B.id, c.windows[0].id);
  console.log("B quote:", { total: qB?.total, advance: qB?.advance, shares: qB?.shares, yourShare: qB?.yourShare, refusal: qB?.refusal });

  // B accepts by paying.
  const o1 = await createChallengePaymentOrder(c.id, B.id, c.windows[0].id);
  console.log("B pay-order:", o1);
  if (!o1.ok) process.exit(1);
  const p1 = payId("B1");
  const r1 = await confirmChallengePayment({
    challengeId: c.id, userId: B.id,
    razorpayOrderId: o1.orderId, razorpayPaymentId: p1, razorpaySignature: sign(o1.orderId, p1),
    platform: "ios",
  });
  console.log("B verify:", r1);
  console.log("after first half:", JSON.stringify(await snapshot(c.id), null, 1));

  // A pays their half.
  const qA = await challengeQuote(c.id, A.id);
  console.log("A quote:", { total: qA?.total, advance: qA?.advance, shares: qA?.shares, yourShare: qA?.yourShare, refusal: qA?.refusal });
  const o2 = await createChallengePaymentOrder(c.id, A.id);
  console.log("A pay-order:", o2);
  if (!o2.ok) process.exit(1);
  const p2 = payId("A1");
  const r2 = await confirmChallengePayment({
    challengeId: c.id, userId: A.id,
    razorpayOrderId: o2.orderId, razorpayPaymentId: p2, razorpaySignature: sign(o2.orderId, p2),
    platform: "ios",
  });
  console.log("A verify:", r2);
  console.log("final:", JSON.stringify(await snapshot(c.id), null, 1));
  console.log("events:", (await events(c.id)).join("\n  "));
  process.exit(0);
})();
