/**
 * The starting library of creative lines.
 *
 * Hinglish in Roman script, which is how Mathura texts and what the
 * venue asked for. Short, lowercase, no exclamation marks, emoji only
 * where they earn their place — the register is a friend nudging you,
 * not a brand announcing something.
 *
 * ── RULES THE COPY FOLLOWS, AND WHY ───────────────────────────────────
 * NO PRICES, NO DISCOUNTS. Not one line implies an offer. A witty line
 *   that suggests money off is a promise the counter has to honour, and
 *   it will be screenshotted.
 * NO AVAILABILITY CLAIMS unless tagged `needs-slots`. Those lines are
 *   gated on real availability by lib/daily-push-lines.ts. Everything
 *   else must read fine on a night that is completely full.
 * NO NAMES, no personal facts. This is one message multicast to
 *   everybody; anything specific to a person belongs in the three
 *   targeted rules instead.
 * TITLES SHORT. Under about forty characters, because that is what an
 *   iOS lock screen shows before it truncates.
 *
 * These are DEFAULTS. Once installed they are ordinary editable rows —
 * the venue can rewrite, disable or delete any of them, and add their
 * own. This file is the starting point and the record of the house
 * voice, not the live copy.
 */

export interface DailyPushLineSeed {
  title: string;
  body: string;
  tags?: string[];
}

export const DEFAULT_DAILY_PUSH_LINES: DailyPushLineSeed[] = [
  // ── Everyday. The bulk of the rotation. ────────────────────────────
  { title: "gully cricket se upgrade", body: "asli turf, asli floodlights. team ko batao." },
  { title: "shaam ka plan?", body: "ek ghanta, ek ground, poori team. baaki hum dekh lenge." },
  { title: "team group zinda hai?", body: "use karne ka time aa gaya. ground ready hai." },
  { title: "11 log dhoondh lo", body: "ground ka intezaam ho chuka hai." },
  { title: "kaam kal bhi rahega", body: "ek ghanta nikaalo. ground yahin hai." },
  { title: "football ya cricket?", body: "dono ho sakta hai. ek hi shaam mein." },
  { title: "pickleball try kiya?", body: "seekhne mein bees minute. chhodne mein mushkil." },
  { title: "bina excuse ke", body: "ground hai. lights hain. ab sirf tum ho." },
  { title: "bat uthao", body: "baaki sab yahan mil jayega." },
  { title: "ek match ho jaye?", body: "slot chuno, team bulao." },
  { title: "aaj khelne ka mann hai", body: "hum jaante hain. isiliye yaad dila rahe hain." },
  { title: "phone rakho, bat pakdo", body: "shaam ka sahi istemaal." },
  { title: "sitting is the new smoking", body: "aur turf ka kiraya doctor se sasta hai." },
  { title: "do ghante, zero notifications", body: "ground pe koi meeting nahi hoti." },
  { title: "captain, team bula lo", body: "ground pe milte hain." },
  { title: "score settle karna hai?", body: "pichhli baar ka hisaab baaki hai." },
  { title: "highlights banane hain?", body: "pehle match to khelo." },
  { title: "warm-up bhool jaate ho", body: "phir agle din pata chalta hai. aaj mat bhoolna." },
  { title: "floodlights on hain", body: "andhera ab bahana nahi raha." },
  { title: "aaj kaun aa raha hai?", body: "group mein poochho, ground mein aao." },
  { title: "turf ki yaad aayi?", body: "wo bhi tumhe miss kar raha tha. thoda." },
  { title: "5-a-side ya 8-a-side", body: "jitne aa jayein, khel ho jayega." },
  { title: "office se seedha ground", body: "kapde badal lena, bas." },
  { title: "ek ghanta apne liye", body: "baaki din to sabka hai." },
  { title: "purani team, naya ground", body: "combination kaafi solid hai." },
  { title: "shaam khaali jaa rahi hai", body: "isko kuch kaam pe laga do." },
  { title: "cricket, football, pickleball", body: "teen options. ek shaam. chuno." },
  { title: "match karwa dein?", body: "team hai to ground hai." },
  { title: "sunday ka intezaar mat karo", body: "aaj bhi khela ja sakta hai." },
  { title: "thak jaoge, achha lagega", body: "wahi to point hai." },
  { title: "ground pe network achha hai", body: "lekin zaroorat nahi padegi." },
  { title: "jitna socha, utna khela?", body: "socha bahut. ab khel bhi lo." },
  { title: "fitness app bata raha hai", body: "ki tum aaj nahi chale. hum bata rahe hain kahan chalo." },
  { title: "teen ghante scroll kiye", body: "ek ghanta khel lo. hisaab barabar." },
  { title: "team ka group photo", body: "match ke baad wala hamesha behtar aata hai." },
  { title: "pickleball samajh nahi aaya?", body: "aake dekho. do point mein aa jayega." },

  // ── Availability claims. Gated on real free slots. ─────────────────
  { title: "shaam khaali hai, turf bhi", body: "sochna kya hai? slot pakad lo.", tags: ["needs-slots"] },
  { title: "aaj jagah hai", body: "kal ke bharose mat raho. aaj khel lo.", tags: ["needs-slots"] },
  { title: "slot khula hai", body: "abhi book karo, shaam tumhaari.", tags: ["needs-slots"] },
  { title: "ground free hai aaj", body: "team bulao, hum wait kar rahe hain.", tags: ["needs-slots"] },
  { title: "last minute plan?", body: "aaj ke liye jagah bachi hai.", tags: ["needs-slots"] },
  { title: "koi cancel kar gaya", body: "unka nuksaan, tumhara fayda. slot khula hai.", tags: ["needs-slots"] },
  { title: "aaj shaam bach gayi", body: "ground khaali hai. le lo.", tags: ["needs-slots"] },
  { title: "jaldi karo, jagah hai", body: "shaam ke slots abhi khule hain.", tags: ["needs-slots"] },

  // ── Day of the week ────────────────────────────────────────────────
  { title: "monday. koi judge nahi kar raha", body: "turf ko farq nahi padta hafte ka din kya hai.", tags: ["monday"] },
  { title: "monday nikalna hai?", body: "ek match. mood theek ho jayega.", tags: ["monday"] },
  { title: "tuesday, sabse shaant shaam", body: "ground pe bheed sabse kam. socho.", tags: ["tuesday"] },
  { title: "midweek slump", body: "wednesday ka ilaaj ground pe milta hai.", tags: ["wednesday"] },
  { title: "aadha hafta ho gaya", body: "abhi tak nahi khela? wednesday hai.", tags: ["wednesday"] },
  { title: "thursday, almost there", body: "weekend ka trailer aaj chala lo.", tags: ["thursday"] },
  { title: "friday hai bhai", body: "weekend shuru karne ka sahi tareeka.", tags: ["friday"] },
  { title: "friday night lights", body: "literally. floodlights on hain.", tags: ["friday"] },
  { title: "saturday ka asli use", body: "so ke nahi, khel ke.", tags: ["saturday"] },
  { title: "sunday morning cricket", body: "chai baad mein. pehle match.", tags: ["sunday"] },
  { title: "weekend nikal jayega", body: "har baar ki tarah. is baar khel lo.", tags: ["weekend"] },
  { title: "do din hain", body: "ek to ground ko de do.", tags: ["weekend"] },

  // ── Season ─────────────────────────────────────────────────────────
  { title: "baarish hui, turf drain ho gaya", body: "tumhara bahana nahi hua.", tags: ["monsoon"] },
  { title: "monsoon mein khelna alag hai", body: "thodi phislan, poora maza.", tags: ["monsoon"] },
  { title: "badal hain, garmi nahi", body: "khelne ka sabse achha mausam.", tags: ["monsoon"] },
  { title: "kohra hai, lights hain", body: "winter cricket ka apna hi mazaa hai.", tags: ["winter"] },
  { title: "thand mein warm-up zaroori", body: "pehle do minute, phir poora ghanta.", tags: ["winter"] },
  { title: "razai chhodo", body: "pandrah minute baad thand yaad nahi rahegi.", tags: ["winter"] },
  { title: "sardi ki shaam, garam match", body: "ground pe milte hain.", tags: ["winter"] },
  { title: "garmi hai, shaam bachi hai", body: "suraj dhalne ke baad ground sabse achha.", tags: ["summer"] },
  { title: "din mein mat aao", body: "shaam saat baje ka slot lo. floodlights ke neeche.", tags: ["summer"] },
  { title: "paani saath laana", body: "garmi hai. baaki sab hum dekh lenge.", tags: ["summer"] },
  { title: "mausam perfect hai", body: "is se behtar khelne ka time nahi milega.", tags: ["pleasant"] },
  { title: "na garmi na sardi", body: "yehi wo do mahine hain. waste mat karo.", tags: ["pleasant"] },

  // ── Festivals. Dated windows, maintained by the venue. ─────────────
  { title: "rang khelo, phir cricket", body: "turf ka rang hum sambhal lenge.", tags: ["holi"] },
  { title: "holi ke baad wala match", body: "Braj ki sabse achhi parampara. shayad.", tags: ["holi"] },
  { title: "gulaal utar gaya?", body: "ab ground chalo.", tags: ["holi"] },
  { title: "poora shehar jaag raha hai", body: "to khel bhi lete hain. janmashtami mubarak.", tags: ["janmashtami"] },
  { title: "kanha ki nagri mein match", body: "janmashtami ki shubhkamnayein.", tags: ["janmashtami"] },
  { title: "diwali ki safai ho gayi?", body: "ab thodi exercise bhi ho jaye.", tags: ["diwali"] },
  { title: "mithai ka hisaab", body: "ek ghanta ground pe. barabar.", tags: ["diwali"] },
  { title: "chhutti hai aaj", body: "ground khula hai. team bulao.", tags: ["holi", "janmashtami", "diwali"] },

  // ── Cricket calendar. Also dated windows. ──────────────────────────
  { title: "match 7:30 pe hai", body: "turf 6 baje. dono ho jayenge.", tags: ["ipl"] },
  { title: "IPL dekh ke khujli hui?", body: "wahi shot yahan try karo.", tags: ["ipl"] },
  { title: "commentary sun ke bore", body: "khud khel ke dekho.", tags: ["ipl"] },
  { title: "india khel raha hai", body: "tum bhi khel lo. pehle wala slot lo.", tags: ["india-match"] },
  { title: "har ball pe advice dete ho", body: "aaj khud bowling karke dikhao.", tags: ["ipl", "india-match"] },
  { title: "sofa se strategy", body: "ground pe aake test karo.", tags: ["ipl", "india-match"] },
];
