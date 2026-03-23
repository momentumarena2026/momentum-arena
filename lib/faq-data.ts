export interface FAQEntry {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  category: string;
}

export const FAQ_CATEGORIES = [
  { id: "facility", label: "Facility", icon: "Building2" },
  { id: "booking", label: "Booking", icon: "CalendarCheck" },
  { id: "pricing", label: "Pricing", icon: "IndianRupee" },
  { id: "payment", label: "Payment", icon: "CreditCard" },
  { id: "cancellation", label: "Cancellation", icon: "XCircle" },
  { id: "sports", label: "Sports", icon: "Dumbbell" },
  { id: "hours", label: "Timing", icon: "Clock" },
  { id: "location", label: "Location", icon: "MapPin" },
] as const;

export const FAQ_ENTRIES: FAQEntry[] = [
  // Facility
  {
    id: "f1",
    question: "What is Momentum Arena?",
    answer: "Momentum Arena is a premium multi-sport facility in Mathura, offering Cricket, Football, Pickleball, and Badminton courts. We have an 80x90 ft main turf with flexible configurations and a separate shared Pickleball/Badminton court.",
    keywords: ["about", "what", "momentum", "arena", "facility"],
    category: "facility",
  },
  {
    id: "f2",
    question: "What amenities are available?",
    answer: "We offer spectator seating areas, a cafeteria with refreshments, ample parking space, professional-grade turf, and well-maintained courts with proper lighting for evening games.",
    keywords: ["amenities", "facilities", "parking", "cafeteria", "seating", "food"],
    category: "facility",
  },
  {
    id: "f3",
    question: "Is there parking available?",
    answer: "Yes, we have dedicated parking space for cars and two-wheelers right at the venue.",
    keywords: ["parking", "car", "bike", "vehicle"],
    category: "facility",
  },
  // Booking
  {
    id: "b1",
    question: "How do I book a court?",
    answer: "1. Log in with your phone/email via OTP\n2. Select your sport (Cricket/Football/Pickleball/Badminton)\n3. Choose court size configuration\n4. Pick your date and time slots\n5. Complete payment\nYour booking is confirmed instantly!",
    keywords: ["book", "reserve", "how", "court", "steps"],
    category: "booking",
  },
  {
    id: "b2",
    question: "Can I book multiple time slots at once?",
    answer: "Yes! You can select multiple 1-hour time slots in a single booking. Just click on multiple slots on the time grid before proceeding to payment.",
    keywords: ["multiple", "slots", "time", "consecutive", "hours"],
    category: "booking",
  },
  {
    id: "b3",
    question: "How long is each time slot?",
    answer: "Each time slot is exactly 1 hour. For example, if you book the 6:00 PM slot, your session runs from 6:00 PM to 7:00 PM.",
    keywords: ["slot", "duration", "hour", "long", "time"],
    category: "booking",
  },
  {
    id: "b4",
    question: "How far in advance can I book?",
    answer: "You can book up to 7 days in advance. The booking calendar shows the next 7 days from today.",
    keywords: ["advance", "days", "ahead", "future", "calendar"],
    category: "booking",
  },
  {
    id: "b5",
    question: "What happens when I select a slot for booking?",
    answer: "When you proceed to checkout, your selected slots are locked for 5 minutes. This means no one else can book them while you complete your payment. If payment isn't completed within 5 minutes, the slots are released.",
    keywords: ["lock", "reserve", "hold", "minutes", "timeout", "locked"],
    category: "booking",
  },
  // Pricing
  {
    id: "p1",
    question: "How is pricing determined?",
    answer: "Pricing varies based on:\n- Court size (Small to Full Field)\n- Day type (Weekday vs Weekend)\n- Time type (Peak vs Off-Peak hours)\n\nWeekday off-peak hours (5 AM - 4 PM) have the lowest rates. Weekend and evening slots are peak-priced.",
    keywords: ["price", "pricing", "cost", "rate", "how much", "charge"],
    category: "pricing",
  },
  {
    id: "p2",
    question: "What are peak and off-peak hours?",
    answer: "Weekday Off-Peak: 5:00 AM - 4:00 PM\nWeekday Peak: 4:00 PM - 1:00 AM\nWeekend: All hours are peak-priced\n\nPeak hours have higher rates due to higher demand.",
    keywords: ["peak", "off-peak", "hours", "weekday", "weekend", "evening"],
    category: "pricing",
  },
  {
    id: "p3",
    question: "What are the court size options and prices?",
    answer: "For Cricket: Small (30x90ft), Medium (40x90ft), Large (60x90ft), XL (70x90ft), Full (80x90ft)\nFor Football: Medium to Full (no Small)\nPickleball & Badminton: Standard shared court\n\nPrices start from ₹400/hour for shared courts to ₹5,000/hour for a full field on weekends.",
    keywords: ["size", "small", "medium", "large", "full", "options", "cricket", "football"],
    category: "pricing",
  },
  {
    id: "p4",
    question: "Are there any discounts available?",
    answer: "Yes! We offer:\n- New user discount on your first booking\n- Promotional discount codes (check our banners for active offers)\n- Special event discounts\n\nEnter your discount code at checkout to avail the offer.",
    keywords: ["discount", "offer", "coupon", "code", "promo", "deal", "first"],
    category: "pricing",
  },
  // Payment
  {
    id: "pay1",
    question: "What payment methods are accepted?",
    answer: "We accept three payment methods:\n1. Online Payment (Razorpay) - Cards, UPI, Netbanking\n2. UPI QR Code - Scan & pay, send screenshot on WhatsApp\n3. Pay at Venue - Pay 20% advance online, rest in cash at venue",
    keywords: ["payment", "pay", "method", "card", "upi", "cash", "online", "razorpay"],
    category: "payment",
  },
  {
    id: "pay2",
    question: "How does the UPI QR payment work?",
    answer: "1. Select UPI QR Code at checkout\n2. Scan the QR code with any UPI app\n3. Make the payment\n4. Send the payment screenshot to our WhatsApp (+91 6396 177 261)\n5. Our team verifies and confirms your booking",
    keywords: ["upi", "qr", "screenshot", "whatsapp", "scan"],
    category: "payment",
  },
  {
    id: "pay3",
    question: "What is the advance payment for Pay at Venue?",
    answer: "When you choose 'Pay at Venue', you need to pay 20% of the total amount online (via Razorpay or UPI QR) as advance. The remaining 80% can be paid in cash when you arrive at the venue.",
    keywords: ["advance", "venue", "cash", "20", "percent", "partial"],
    category: "payment",
  },
  {
    id: "pay4",
    question: "Is my payment secure?",
    answer: "Yes! Online payments are processed through Razorpay, India's leading payment gateway. All transactions are encrypted and PCI-DSS compliant. We never store your card details.",
    keywords: ["secure", "safe", "security", "encrypted", "trust"],
    category: "payment",
  },
  // Cancellation
  {
    id: "c1",
    question: "Can I cancel my booking?",
    answer: "Bookings cannot be cancelled directly through the app. For exceptional cases, please call us at +91 6396 177 261. Refunds are processed on a case-by-case basis by our admin team.",
    keywords: ["cancel", "cancellation", "refund", "change", "modify"],
    category: "cancellation",
  },
  {
    id: "c2",
    question: "How do refunds work?",
    answer: "Refunds are handled by our admin team for exceptional cases only. If approved, the refund is processed back to your original payment method. Contact us on WhatsApp at +91 6396 177 261 for refund requests.",
    keywords: ["refund", "money", "back", "return"],
    category: "cancellation",
  },
  // Sports
  {
    id: "s1",
    question: "What sports are available?",
    answer: "We offer four sports:\n1. Cricket - Box cricket with multiple pitch configurations\n2. Football - Indoor football with flexible field sizes\n3. Pickleball - Professional court with proper markings\n4. Badminton - Standard court with competition markings\n\nCricket and Football share the main 80x90ft turf. Pickleball and Badminton share a separate dedicated court.",
    keywords: ["sports", "available", "cricket", "football", "pickleball", "badminton", "what"],
    category: "sports",
  },
  {
    id: "s2",
    question: "How does the shared court work for Pickleball and Badminton?",
    answer: "Pickleball and Badminton share the same physical court with different colored markings for each sport. When one sport is booked for a time slot, the other is automatically blocked for that same slot.",
    keywords: ["shared", "pickleball", "badminton", "court", "same", "block"],
    category: "sports",
  },
  {
    id: "s3",
    question: "What are the cricket field configurations?",
    answer: "Our 80x90ft turf can be configured as:\n- Small (30x90ft) - Single box lane, great for practice\n- Medium (40x90ft) - Box lane + leather pitch\n- Large (60x90ft) - Two box lanes\n- XL (70x90ft) - Two lanes + leather pitch\n- Full Field (80x90ft) - Complete field\n\nThe turf has sliding partition nets at 10ft, 40ft, and 70ft positions.",
    keywords: ["cricket", "configuration", "field", "size", "box", "lane", "pitch", "net"],
    category: "sports",
  },
  // Hours
  {
    id: "h1",
    question: "What are the operating hours?",
    answer: "We are open daily from 5:00 AM to 1:00 AM (next day). That's 20 hours of play time every day! Bookings are available in 1-hour slots throughout operating hours.",
    keywords: ["hours", "time", "open", "close", "operating", "when", "timing"],
    category: "hours",
  },
  {
    id: "h2",
    question: "Are you open on weekends and holidays?",
    answer: "Yes! We are open every day including weekends and public holidays. Weekend pricing applies on Saturdays and Sundays.",
    keywords: ["weekend", "holiday", "sunday", "saturday", "open"],
    category: "hours",
  },
  // Location
  {
    id: "l1",
    question: "Where is Momentum Arena located?",
    answer: "Momentum Arena is located at:\nKhasra no. 293/5, Mouja Ganeshra\nRadhapuram Road\nMathura, Uttar Pradesh 281004\n\nYou can find us on Google Maps for easy navigation.",
    keywords: ["location", "where", "address", "directions", "map", "mathura"],
    category: "location",
  },
  {
    id: "l2",
    question: "How can I contact Momentum Arena?",
    answer: "You can reach us via:\n- WhatsApp: +91 6396 177 261\n- Phone: +91 6396 177 261\n- Visit us at the venue\n\nFor booking queries, WhatsApp is the fastest way to reach us.",
    keywords: ["contact", "phone", "whatsapp", "call", "reach", "number"],
    category: "location",
  },
];
