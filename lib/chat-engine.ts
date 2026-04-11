/**
 * Smart Chat Engine — Free AI-like assistant for Momentum Arena
 *
 * Uses intent classification, entity extraction, conversation context,
 * fuzzy matching, Hindi/Hinglish support, and template-based NLG
 * to provide intelligent responses without any paid API.
 */

import { FAQ_ENTRIES } from "./faq-data";

// ─── Types ───────────────────────────────────────────────────────
export type Intent =
  | "greeting"
  | "farewell"
  | "booking_how"
  | "booking_status"
  | "sports_available"
  | "sport_info"
  | "pricing"
  | "pricing_specific"
  | "payment_methods"
  | "upi_qr"
  | "advance_payment"
  | "cancellation"
  | "refund"
  | "hours"
  | "location"
  | "contact"
  | "parking"
  | "amenities"
  | "cafe"
  | "rewards"
  | "coupons"
  | "slot_duration"
  | "booking_advance"
  | "slot_lock"
  | "shared_court"
  | "cricket_config"
  | "equipment"
  | "waitlist"
  | "thank_you"
  | "help"
  | "unknown";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  quickActions?: { label: string; href: string }[];
  timestamp: number;
}

interface IntentPattern {
  intent: Intent;
  patterns: RegExp[];
  keywords: string[];
  hindiKeywords?: string[];
  priority: number;
}

interface ConversationContext {
  lastIntent: Intent | null;
  mentionedSport: string | null;
  mentionedDate: string | null;
  turnCount: number;
  askedFollowUp: boolean;
}

// ─── Intent Patterns ─────────────────────────────────────────────
const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "greeting",
    patterns: [/^(hi|hello|hey|howdy|sup|yo|hola)\b/i, /^(good\s*(morning|afternoon|evening|night))/i, /^(namaste|namaskar)/i],
    keywords: ["hi", "hello", "hey", "namaste"],
    hindiKeywords: ["namaste", "namaskar", "kaise ho", "kya hal"],
    priority: 1,
  },
  {
    intent: "farewell",
    patterns: [/^(bye|goodbye|see you|cya|tata|alvida)\b/i, /thanks?\s*(bye|goodbye)/i],
    keywords: ["bye", "goodbye", "see you"],
    hindiKeywords: ["alvida", "phir milenge", "tata"],
    priority: 1,
  },
  {
    intent: "thank_you",
    patterns: [/\b(thanks?|thank\s*you|thx|ty|dhanyavaad|shukriya)\b/i],
    keywords: ["thanks", "thank you", "thankyou"],
    hindiKeywords: ["dhanyavaad", "shukriya", "bahut accha"],
    priority: 2,
  },
  {
    intent: "booking_how",
    patterns: [
      /how\s*(do|can|to)\s*(i|we)?\s*book/i,
      /book\s*(a|the)?\s*(court|slot|ground|field)/i,
      /booking\s*(process|steps|kaise)/i,
      /want\s*to\s*book/i,
      /\bbook\s*karna/i,
      /\bbook\s*kaise/i,
    ],
    keywords: ["book", "booking", "reserve", "reservation"],
    hindiKeywords: ["book karna", "book kaise", "booking kaise", "reserve"],
    priority: 3,
  },
  {
    intent: "booking_status",
    patterns: [/booking\s*(status|check|dekho|dikhao)/i, /my\s*booking/i, /where.*booking/i],
    keywords: ["booking status", "my booking", "check booking"],
    hindiKeywords: ["meri booking", "booking status"],
    priority: 3,
  },
  {
    intent: "sports_available",
    patterns: [
      /what\s*(sports?|games?)\s*(are|is)?\s*(available|offer|have|there)/i,
      /which\s*sports?/i,
      /sports?\s*(available|offered|list)/i,
      /kaun\s*sa\s*sport/i,
      /kya\s*kya\s*(khel|sport)/i,
    ],
    keywords: ["sports", "games", "available sports", "which sport"],
    hindiKeywords: ["kaun sa sport", "kya kya hai", "khel"],
    priority: 3,
  },
  {
    intent: "sport_info",
    patterns: [
      /\b(cricket|football|pickleball|badminton)\b.*\b(info|about|tell|details?|batao)\b/i,
      /\babout\b.*\b(cricket|football|pickleball|badminton)\b/i,
      /\btell\b.*\b(cricket|football|pickleball|badminton)\b/i,
    ],
    keywords: ["cricket", "football", "pickleball", "badminton"],
    priority: 2,
  },
  {
    intent: "pricing",
    patterns: [
      /\b(price|pricing|cost|rate|charge|kitna|kitne|paisa|rupee|rupay)\b/i,
      /how\s*much/i,
      /kya\s*rate/i,
      /kitna\s*(paisa|lagega|hoga)/i,
    ],
    keywords: ["price", "pricing", "cost", "rate", "charge", "how much", "fees"],
    hindiKeywords: ["kitna", "kitne", "rate", "paisa", "lagega"],
    priority: 3,
  },
  {
    intent: "pricing_specific",
    patterns: [
      /\b(cricket|football|pickleball|badminton)\b.*\b(price|cost|rate|kitna)\b/i,
      /\b(price|cost|rate)\b.*\b(cricket|football|pickleball|badminton)\b/i,
    ],
    keywords: [],
    priority: 4,
  },
  {
    intent: "payment_methods",
    patterns: [
      /\b(payment|pay)\s*(method|option|mode|kaise|how)/i,
      /how\s*(to|can)\s*pay/i,
      /kaise\s*pay/i,
      /payment\s*accept/i,
    ],
    keywords: ["payment", "pay", "method", "option", "mode"],
    hindiKeywords: ["payment kaise", "pay kaise", "paisa kaise de"],
    priority: 3,
  },
  {
    intent: "upi_qr",
    patterns: [/upi\s*qr/i, /qr\s*code/i, /scan\s*(and|&)?\s*pay/i],
    keywords: ["upi", "qr", "scan"],
    priority: 4,
  },
  {
    intent: "advance_payment",
    patterns: [/advance\s*payment/i, /pay\s*at\s*venue/i, /cash\s*payment/i, /partial\s*pay/i, /50\s*%/],
    keywords: ["advance", "venue", "cash", "partial"],
    priority: 4,
  },
  {
    intent: "cancellation",
    patterns: [/\b(cancel|cancellation)\b/i, /\bcancel\s*karna\b/i, /\bcancel\s*kaise\b/i],
    keywords: ["cancel", "cancellation"],
    hindiKeywords: ["cancel karna", "cancel kaise"],
    priority: 3,
  },
  {
    intent: "refund",
    patterns: [/\brefund\b/i, /money\s*back/i, /paisa\s*wapas/i],
    keywords: ["refund", "money back"],
    hindiKeywords: ["refund", "paisa wapas"],
    priority: 3,
  },
  {
    intent: "hours",
    patterns: [
      /\b(hours?|timing|time|open|close|kab)\b.*\b(open|close|timing|baje)\b/i,
      /\boperating\s*hours?\b/i,
      /when\s*(do\s*you|are\s*you)\s*open/i,
      /kab\s*(khulta|band)/i,
      /kitne\s*baje/i,
    ],
    keywords: ["hours", "timing", "open", "close", "when", "time"],
    hindiKeywords: ["kab khulta", "kab band", "kitne baje", "timing"],
    priority: 3,
  },
  {
    intent: "location",
    patterns: [
      /\b(where|location|address|direction|kahan|kidhar)\b/i,
      /how\s*to\s*(reach|get\s*to|come)/i,
      /google\s*maps?/i,
    ],
    keywords: ["where", "location", "address", "directions", "map"],
    hindiKeywords: ["kahan", "kidhar", "address", "rasta"],
    priority: 3,
  },
  {
    intent: "contact",
    patterns: [
      /\b(contact|phone|whatsapp|call|number|email)\b/i,
      /\bcontact\s*(number|info|details?)\b/i,
    ],
    keywords: ["contact", "phone", "whatsapp", "call", "number", "email"],
    hindiKeywords: ["phone number", "call karo", "whatsapp"],
    priority: 3,
  },
  {
    intent: "parking",
    patterns: [/\bparking\b/i, /\bgaadi\b/i],
    keywords: ["parking", "car", "bike", "vehicle"],
    hindiKeywords: ["parking", "gaadi"],
    priority: 3,
  },
  {
    intent: "amenities",
    patterns: [/\b(amenities|facilities|washroom|toilet|bathroom)\b/i],
    keywords: ["amenities", "facilities", "washroom"],
    priority: 3,
  },
  {
    intent: "cafe",
    patterns: [/\b(cafe|cafeteria|food|snack|drink|khana|chai|coffee)\b/i, /\bcafe\s*menu\b/i],
    keywords: ["cafe", "food", "snack", "drink", "menu", "eat"],
    hindiKeywords: ["khana", "chai", "coffee", "canteen"],
    priority: 3,
  },
  {
    intent: "rewards",
    patterns: [/\b(reward|loyalty|points?|tier|bronze|silver|gold|platinum)\b/i],
    keywords: ["rewards", "points", "loyalty", "tier"],
    priority: 3,
  },
  {
    intent: "coupons",
    patterns: [/\b(coupon|discount|promo|offer|code)\b/i, /\bnew\s*user\s*discount\b/i],
    keywords: ["coupon", "discount", "promo", "offer", "code"],
    priority: 3,
  },
  {
    intent: "slot_duration",
    patterns: [/\b(slot|session)\s*(duration|long|kitna)\b/i, /how\s*long.*slot/i],
    keywords: ["slot duration", "how long"],
    priority: 4,
  },
  {
    intent: "booking_advance",
    patterns: [/how\s*(far|many\s*days)\s*in\s*advance/i, /advance\s*booking/i, /kitne\s*din\s*pehle/i],
    keywords: ["advance booking", "days ahead"],
    priority: 4,
  },
  {
    intent: "slot_lock",
    patterns: [/slot\s*(lock|hold|reserve)/i, /lock\s*time/i],
    keywords: ["slot lock", "hold", "timeout"],
    priority: 4,
  },
  {
    intent: "shared_court",
    patterns: [/shared\s*court/i, /pickleball.*badminton/i, /badminton.*pickleball/i],
    keywords: ["shared court"],
    priority: 4,
  },
  {
    intent: "cricket_config",
    patterns: [/cricket\s*(config|size|field|ground|box|lane)/i, /box\s*(cricket|a|b)/i, /leather\s*(pitch|1|2)/i],
    keywords: ["cricket config", "box cricket", "field size"],
    priority: 4,
  },
  {
    intent: "equipment",
    patterns: [/\b(equipment|rental|rent|bat|ball|racket|shuttle)\b/i],
    keywords: ["equipment", "rental", "rent", "bat", "ball"],
    hindiKeywords: ["saman", "equipment"],
    priority: 3,
  },
  {
    intent: "waitlist",
    patterns: [/\b(waitlist|wait\s*list|notify\s*me|slot\s*available)\b/i],
    keywords: ["waitlist", "notify", "waiting"],
    priority: 3,
  },
  {
    intent: "help",
    patterns: [/^(help|menu|options|kya\s*kar\s*sakte)\b/i, /what\s*can\s*you\s*do/i],
    keywords: ["help", "menu", "options"],
    hindiKeywords: ["kya kar sakte", "madad"],
    priority: 1,
  },
];

// ─── Response Templates ──────────────────────────────────────────
const RESPONSES: Record<Intent, (ctx: ConversationContext) => { content: string; suggestions?: string[]; quickActions?: { label: string; href: string }[] }> = {
  greeting: () => ({
    content: randomPick([
      "Hey there! 👋 Welcome to Momentum Arena. I can help you with bookings, pricing, sports info, and more. What would you like to know?",
      "Hello! 🏏 I'm your Momentum Arena assistant. Ask me about booking courts, pricing, sports, café, or anything else!",
      "Hi! ⚽ Great to see you. Whether you need to book a court, check pricing, or know our timings — I'm here to help!",
    ]),
    suggestions: ["Book a court", "Sports available", "Pricing info", "Operating hours"],
  }),

  farewell: () => ({
    content: randomPick([
      "See you on the field! 🏆 Feel free to come back anytime you have questions.",
      "Bye! 👋 Hope to see you at Momentum Arena soon. Have a great day!",
      "Take care! 🎯 Book your next session anytime at momentumarena.in",
    ]),
  }),

  thank_you: () => ({
    content: randomPick([
      "You're welcome! 😊 Anything else I can help with?",
      "Happy to help! 🙌 Let me know if you need anything else.",
      "Glad I could help! Feel free to ask more questions anytime.",
    ]),
    suggestions: ["Book a court", "View pricing", "Contact us"],
  }),

  booking_how: () => ({
    content: "Booking a court is super easy! Here's how:\n\n1️⃣ Pick your sport (Cricket, Football, Pickleball, Badminton)\n2️⃣ Choose court size\n3️⃣ Select date & time slots\n4️⃣ Complete payment\n\n✅ Booking is confirmed instantly! The whole process takes under 2 minutes.",
    suggestions: ["What sports?", "Pricing info", "Payment methods"],
    quickActions: [{ label: "Book Now →", href: "/book" }],
  }),

  booking_status: () => ({
    content: "You can check your bookings from your dashboard. All upcoming and past bookings are listed there with full details including QR code for check-in.",
    quickActions: [
      { label: "My Bookings →", href: "/bookings" },
      { label: "Dashboard →", href: "/dashboard" },
    ],
  }),

  sports_available: () => ({
    content: "We offer 4 exciting sports at Momentum Arena! 🏟️\n\n🏏 **Cricket** — Box cricket with 5 size configs (Small → Full 80×90ft)\n⚽ **Football** — Indoor football (Half or Full ground)\n🏓 **Pickleball** — Professional court with proper markings\n🏸 **Badminton** — Standard competition court\n\nAll courts have premium turf and floodlights for evening play!",
    suggestions: ["Cricket details", "Book a court", "Pricing"],
    quickActions: [{ label: "Book Now →", href: "/book" }],
  }),

  sport_info: (ctx) => {
    const sport = ctx.mentionedSport?.toLowerCase();
    const info: Record<string, string> = {
      cricket: "🏏 **Cricket at Momentum Arena**\n\nOur 80×90ft main turf can be configured as:\n• Small (30×90ft) — Single box lane, great for practice\n• Medium (40×90ft) — Box + leather pitch\n• Large (60×90ft) — Two box lanes\n• XL (70×90ft) — Two lanes + leather pitch\n• Full Field (80×90ft) — Complete field\n\nSliding partition nets at 10ft, 40ft, and 70ft positions.",
      football: "⚽ **Football at Momentum Arena**\n\nIndoor football on premium turf:\n• Half Ground — Great for small-sided games (5v5/6v6)\n• Full Ground (80×90ft) — Full matches\n\nProfessional-grade artificial turf with proper markings.",
      pickleball: "🏓 **Pickleball at Momentum Arena**\n\nProfessional court with:\n• Standard competition markings\n• Quality nets and playing surface\n• Shared court system (blocks badminton when booked)\n\nPerfect for beginners and pros alike!",
      badminton: "🏸 **Badminton at Momentum Arena**\n\nStandard competition court:\n• Proper BWF-standard markings\n• Quality net setup\n• Shared with pickleball court\n\nGreat for casual rallies or competitive matches!",
    };
    return {
      content: info[sport || ""] || "We offer Cricket, Football, Pickleball, and Badminton. Which sport would you like to know more about?",
      suggestions: ["Book this sport", "Pricing info", "Other sports"],
      quickActions: sport ? [{ label: `Book ${sport.charAt(0).toUpperCase() + sport.slice(1)} →`, href: `/book/${sport}` }] : undefined,
    };
  },

  pricing: () => ({
    content: "💰 **Pricing at Momentum Arena**\n\nPrices depend on:\n• **Sport & Court size** — Shared courts from ₹400/hr, Full field up to ₹5,000/hr\n• **Day type** — Weekday vs Weekend\n• **Time** — Off-peak (5 AM–4 PM weekdays) vs Peak hours\n\n🏷️ New users get an automatic welcome discount!\n\nCheck exact prices for your preferred sport & time on the booking page.",
    suggestions: ["Cricket pricing", "Payment methods", "Coupons & discounts"],
    quickActions: [{ label: "Check Prices →", href: "/book" }],
  }),

  pricing_specific: (ctx) => {
    const sport = ctx.mentionedSport?.toLowerCase();
    const info: Record<string, string> = {
      cricket: "🏏 Cricket pricing varies by field size:\n• Small (30×90): ₹800–₹1,200/hr\n• Medium (40×90): ₹1,000–₹1,500/hr\n• Large (60×90): ₹1,500–₹2,200/hr\n• Full (80×90): ₹3,000–₹5,000/hr\n\nWeekday off-peak has lowest rates. Check exact prices on the booking page!",
      football: "⚽ Football pricing:\n• Half Ground: ₹1,000–₹1,800/hr\n• Full Ground: ₹3,000–₹5,000/hr\n\nWeekday off-peak (5 AM–4 PM) is cheapest!",
      pickleball: "🏓 Pickleball pricing:\n• Shared Court: ₹400–₹600/hr\n\nMost affordable option! Great weekday off-peak rates.",
      badminton: "🏸 Badminton pricing:\n• Shared Court: ₹400–₹600/hr\n\nSimilar to pickleball pricing. Weekday off-peak is best value!",
    };
    return {
      content: info[sport || ""] || "Pricing depends on sport & court size. Which sport are you interested in?",
      suggestions: ["Book now", "Payment methods", "Coupons"],
      quickActions: sport ? [{ label: `Book ${sport.charAt(0).toUpperCase() + sport.slice(1)} →`, href: `/book/${sport}` }] : [{ label: "View All Sports →", href: "/book" }],
    };
  },

  payment_methods: () => ({
    content: "We accept 3 payment methods:\n\n💳 **Online (Razorpay)** — Cards, UPI, Net Banking. Instant confirmation!\n📱 **UPI QR Code** — Scan & pay, send screenshot on WhatsApp\n🏪 **Pay at Venue** — Pay 50% advance online, rest in cash\n\nAll online payments are secured by Razorpay (PCI-DSS compliant).",
    suggestions: ["UPI QR details", "Advance payment info", "Book now"],
  }),

  upi_qr: () => ({
    content: "📱 **UPI QR Payment:**\n\n1. Select 'UPI QR' at checkout\n2. Scan the QR code with any UPI app (GPay, PhonePe, Paytm)\n3. Complete payment\n4. Enter UTR number or send screenshot to WhatsApp\n5. Team verifies & confirms booking\n\n📞 WhatsApp: +91 6396 177 261",
    suggestions: ["Other payment methods", "Book now"],
  }),

  advance_payment: () => ({
    content: "🏪 **Pay at Venue option:**\n\n• Pay **50% advance** online (via Razorpay or UPI QR)\n• Pay remaining **50% in cash** at the venue\n• Great if you prefer cash payments!\n\nYour booking is confirmed once the 50% advance is received.",
    suggestions: ["Other payment methods", "Book now"],
  }),

  cancellation: () => ({
    content: "❌ **Cancellation Policy:**\n\nBookings can't be cancelled through the app directly. For special cases:\n\n📞 Call: +91 6396 177 261\n💬 WhatsApp: +91 6396 177 261\n\nOur admin team handles cancellations on a case-by-case basis.",
    suggestions: ["Refund policy", "Contact us", "Book new slot"],
  }),

  refund: () => ({
    content: "💸 **Refund Policy:**\n\nRefunds are handled by our admin team for exceptional cases. If approved, online payments will be refunded to the original method.\n\n📞 Contact us: +91 6396 177 261",
    suggestions: ["Cancel booking", "Contact"],
  }),

  hours: () => ({
    content: "🕐 **Operating Hours:**\n\n⏰ **5:00 AM — 1:00 AM** (next day)\n📅 **Open 7 days a week** including weekends & holidays!\n\nThat's 20 hours of play time every single day. Slots are available in 1-hour blocks throughout.\n\n💡 Weekday 5 AM–4 PM = Off-peak (lowest prices!)",
    suggestions: ["Book now", "Pricing", "Location"],
  }),

  location: () => ({
    content: "📍 **Momentum Arena**\nKhasra no. 293/5, Mouja Ganeshra\nRadhapuram Road, Mathura, UP 281004\n\n🗺️ Find us on Google Maps for easy navigation!\n\n🚗 Ample parking available for cars & bikes.",
    suggestions: ["Contact us", "Parking info", "Operating hours"],
    quickActions: [{ label: "Open in Maps →", href: "https://maps.google.com/?q=Momentum+Arena+Mathura" }],
  }),

  contact: () => ({
    content: "📞 **Contact Us:**\n\n💬 WhatsApp: **+91 6396 177 261** (fastest!)\n📱 Phone: **+91 6396 177 261**\n📧 Email: momentumarena2026@gmail.com\n\n🏢 Visit us: Radhapuram Road, Mathura, UP\n\nWhatsApp is the quickest way to reach us!",
    suggestions: ["Location & directions", "Operating hours", "Book a court"],
  }),

  parking: () => ({
    content: "🚗 Yes, we have dedicated parking!\n\n• Car parking available\n• Two-wheeler parking available\n• Right at the venue entrance\n• Free for all visitors",
    suggestions: ["Location", "Amenities", "Book now"],
  }),

  amenities: () => ({
    content: "🏟️ **Amenities at Momentum Arena:**\n\n• 🏗️ Professional-grade courts & turf\n• 💡 Floodlights for evening play\n• 🍽️ Full café with food & drinks\n• 🚗 Free parking\n• 🚿 Clean washrooms\n• 🪑 Spectator seating areas\n• 🏏 Equipment rental available",
    suggestions: ["Café menu", "Equipment rental", "Book now"],
  }),

  cafe: () => ({
    content: "☕ **Momentum Arena Café:**\n\nFull menu with:\n• 🥪 Snacks & Quick Bites\n• 🍔 Meals (Veg & Non-veg)\n• 🥤 Beverages (Chai, Coffee, Juices)\n• 🍰 Desserts\n• 🎯 Combo offers\n\nOrder online or at the counter. Perfect for refueling between games!",
    suggestions: ["View menu", "Book a court", "Operating hours"],
    quickActions: [{ label: "Order from Café →", href: "/cafe" }],
  }),

  rewards: () => ({
    content: "🏆 **Momentum Rewards Program:**\n\nEarn points on every booking & café order!\n\n🥉 **Bronze** → Starting tier\n🥈 **Silver** → Unlock at 500 pts\n🥇 **Gold** → Unlock at 1,500 pts\n💎 **Platinum** → Unlock at 5,000 pts\n\nHigher tiers = better rewards & exclusive perks!",
    suggestions: ["View my rewards", "Coupons", "Book now"],
    quickActions: [{ label: "My Rewards →", href: "/rewards" }],
  }),

  coupons: () => ({
    content: "🏷️ **Discounts & Coupons:**\n\n🎉 **New users** get an automatic welcome discount on first booking!\n🎟️ Check active promotional codes on our banners\n💰 Enter coupon code at checkout\n\nKeep an eye on our announcements for flash deals!",
    suggestions: ["View coupons", "Book now", "Pricing"],
    quickActions: [{ label: "View Coupons →", href: "/coupons" }],
  }),

  slot_duration: () => ({
    content: "⏱️ Each time slot is exactly **1 hour**.\n\nFor example, booking the 6 PM slot = 6:00 PM to 7:00 PM.\n\nYou can select **multiple consecutive slots** in a single booking for longer sessions!",
    suggestions: ["How to book", "Pricing", "Slot lock info"],
  }),

  booking_advance: () => ({
    content: "📅 You can book up to **7 days in advance**.\n\nThe booking calendar shows the next 7 days from today. Plan ahead to get your preferred time slots, especially for weekends!",
    suggestions: ["Book now", "Operating hours", "Pricing"],
    quickActions: [{ label: "Book Now →", href: "/book" }],
  }),

  slot_lock: () => ({
    content: "🔒 **Slot Locking:**\n\nWhen you proceed to checkout, your selected slots are **locked for 5 minutes**. No one else can book them while you pay.\n\n⚠️ If payment isn't completed in 5 minutes, slots are automatically released for others.",
    suggestions: ["How to book", "Payment methods"],
  }),

  shared_court: () => ({
    content: "🤝 **Shared Court System:**\n\nPickleball and Badminton share the same physical court with different colored markings.\n\nWhen one sport is booked for a time slot, the other is **automatically blocked** for that same slot. First come, first served!",
    suggestions: ["Pickleball info", "Badminton info", "Book now"],
  }),

  cricket_config: () => ({
    content: "🏏 **Cricket Field Configurations:**\n\nOur 80×90ft turf has sliding nets at 10ft, 40ft & 70ft:\n\n• **Small** (30×90ft) — Single box lane, practice sessions\n• **Medium** (40×90ft) — Box + leather pitch\n• **Large** (60×90ft) — Two box lanes\n• **XL** (70×90ft) — Two lanes + leather pitch\n• **Full** (80×90ft) — Complete field\n\n💡 Book 'Small' for budget-friendly box cricket!",
    suggestions: ["Cricket pricing", "Book cricket", "Other sports"],
    quickActions: [{ label: "Book Cricket →", href: "/book/cricket" }],
  }),

  equipment: () => ({
    content: "🏏 **Equipment Rental:**\n\nWe offer equipment rental at checkout! Available items include bats, balls, rackets, and more based on your sport.\n\nJust select equipment add-ons during the booking process. Available units and prices shown at checkout.",
    suggestions: ["Book now", "Pricing", "Sports available"],
    quickActions: [{ label: "Book & Add Equipment →", href: "/book" }],
  }),

  waitlist: () => ({
    content: "🔔 **Waitlist System:**\n\nSlot already booked? No worries!\n\n• Click 'Notify Me' on any unavailable slot\n• You'll get an SMS when it opens up\n• First to respond gets the slot!\n\nNever miss your preferred time again.",
    suggestions: ["My waitlist", "Book available slots", "Operating hours"],
    quickActions: [{ label: "My Waitlist →", href: "/waitlist" }],
  }),

  help: () => ({
    content: "I can help you with:\n\n🏏 **Sports** — What's available, court details\n📅 **Booking** — How to book, slot info\n💰 **Pricing** — Rates, discounts, coupons\n💳 **Payments** — Methods, UPI\n🕐 **Hours** — When we're open\n📍 **Location** — Address, parking, contact\n☕ **Café** — Menu, ordering\n🏆 **Rewards** — Points, tiers\n\nJust ask anything!",
    suggestions: ["Book a court", "Pricing info", "Sports available", "Contact us"],
  }),

  unknown: (ctx) => {
    // Try FAQ fuzzy search as fallback
    const fallbackFaq = searchFAQFuzzy(ctx.lastIntent?.toString() || "");
    if (fallbackFaq) {
      return {
        content: fallbackFaq,
        suggestions: ["Book a court", "Pricing", "Contact us", "Help"],
      };
    }
    return {
      content: randomPick([
        "Hmm, I'm not sure about that. Try asking about bookings, pricing, sports, or our facility! Or contact us directly:",
        "I didn't quite catch that. I can help with bookings, pricing, sports info, timings, and more. Here's how to reach us:",
        "That's outside my expertise, but I can help with anything about Momentum Arena! Try one of these topics:",
      ]) + "\n\n📞 WhatsApp: +91 6396 177 261",
      suggestions: ["Help — what can you do?", "Book a court", "Contact us", "Pricing"],
    };
  },
};

// ─── Entity Extraction ───────────────────────────────────────────
function extractSport(text: string): string | null {
  const sportMap: Record<string, string> = {
    cricket: "cricket",
    football: "football",
    soccer: "football",
    pickleball: "pickleball",
    pickle: "pickleball",
    badminton: "badminton",
    shuttlecock: "badminton",
  };
  const lower = text.toLowerCase();
  for (const [key, sport] of Object.entries(sportMap)) {
    if (lower.includes(key)) return sport;
  }
  return null;
}

// ─── Intent Classification ───────────────────────────────────────
function classifyIntent(text: string, context: ConversationContext): Intent {
  const lower = text.toLowerCase().trim();
  let bestIntent: Intent = "unknown";
  let bestScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;

    // Regex pattern match (highest confidence)
    for (const regex of pattern.patterns) {
      if (regex.test(lower)) {
        score = Math.max(score, pattern.priority * 3);
      }
    }

    // Keyword match
    for (const kw of pattern.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score = Math.max(score, pattern.priority * 2);
      }
    }

    // Hindi keyword match
    if (pattern.hindiKeywords) {
      for (const kw of pattern.hindiKeywords) {
        if (lower.includes(kw.toLowerCase())) {
          score = Math.max(score, pattern.priority * 2);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = pattern.intent;
    }
  }

  return bestIntent;
}

// ─── Fuzzy FAQ Search (fallback) ─────────────────────────────────
function searchFAQFuzzy(query: string): string | null {
  if (!query) return null;

  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (tokens.length === 0) return null;

  let bestMatch: { entry: typeof FAQ_ENTRIES[0]; score: number } | null = null;

  for (const entry of FAQ_ENTRIES) {
    let score = 0;
    const all = `${entry.question} ${entry.answer} ${entry.keywords.join(" ")}`.toLowerCase();

    for (const token of tokens) {
      if (all.includes(token)) score += 2;
      if (entry.keywords.some(k => k.includes(token))) score += 3;
    }

    if (score > (bestMatch?.score || 3)) {
      bestMatch = { entry, score };
    }
  }

  return bestMatch ? `**${bestMatch.entry.question}**\n\n${bestMatch.entry.answer}` : null;
}

// ─── Helpers ─────────────────────────────────────────────────────
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Main Chat Function ──────────────────────────────────────────
export function processMessage(
  userText: string,
  context: ConversationContext
): { response: ChatMessage; updatedContext: ConversationContext } {
  // Extract entities
  const sport = extractSport(userText);

  // Update context
  const updatedContext: ConversationContext = {
    ...context,
    mentionedSport: sport || context.mentionedSport,
    turnCount: context.turnCount + 1,
  };

  // Classify intent
  const intent = classifyIntent(userText, updatedContext);
  updatedContext.lastIntent = intent;

  // Generate response
  const responseData = RESPONSES[intent](updatedContext);

  const response: ChatMessage = {
    id: `bot-${Date.now()}`,
    role: "assistant",
    content: responseData.content,
    suggestions: responseData.suggestions,
    quickActions: responseData.quickActions,
    timestamp: Date.now(),
  };

  return { response, updatedContext };
}

// ─── Create Initial Context ──────────────────────────────────────
export function createInitialContext(): ConversationContext {
  return {
    lastIntent: null,
    mentionedSport: null,
    mentionedDate: null,
    turnCount: 0,
    askedFollowUp: false,
  };
}
