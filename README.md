# F-ComFlow — প্রজেক্টের সম্পূর্ণ পরিচিতি (সহজ বাংলায়)

> এই ফাইলটি পড়লে যে কেউ — এমনকি প্রোগ্রামিং কম জানলেও — বুঝতে পারবে এই প্রজেক্টে
> কী কী টেকনোলজি ব্যবহার হয়েছে, কোন জিনিসটা কীভাবে কাজ করে, আর কোডটা কোথায় কী আছে।

---

## ১. প্রজেক্টটা আসলে কী?

**F-ComFlow হলো বাংলাদেশের ফেসবুক-ব্যবসায়ীদের (f-commerce) জন্য একটা সম্পূর্ণ ব্যবসা পরিচালনার সফটওয়্যার।**

বাংলাদেশে ৩ লাখের বেশি মানুষ Facebook/WhatsApp-এ পণ্য বিক্রি করেন। তাদের সমস্যাগুলো:

- কাস্টমারের মেসেজ থেকে অর্ডার **হাতে লিখে** খাতায় তুলতে হয় — ভুল হয়, সময় নষ্ট হয়
- স্টক কত আছে জানা থাকে না — **একই পণ্য দুইজনকে বিক্রি** হয়ে যায় (double-selling)
- ক্যাশ অন ডেলিভারির (COD) **২০-৪০% পার্সেল ফেরত আসে** — প্রতিটা ফেরত মানে লস
- টাকার হিসাব (ফি, ভ্যাট) **আন্দাজে** করতে হয়

F-ComFlow এই সবগুলো সমস্যা **একটা ড্যাশবোর্ডে** সমাধান করে:
মেসেজ → AI দিয়ে অর্ডার তৈরি → স্টক রিজার্ভ → রিস্ক স্কোর → কুরিয়ার বুকিং → পেমেন্ট → হিসাবের খাতা।

---

## ২. কী কী টেকনোলজি ব্যবহার হয়েছে (আর কেন)

প্রজেক্টটা ৩টা আলাদা অ্যাপ্লিকেশনে ভাগ করা — একে বলে **microservice-ধাঁচের আর্কিটেকচার**:

```
client/   → ড্যাশবোর্ড (ইউজার যা দেখে)          — চলে port 3000-এ
server/   → API সার্ভার (সব হিসাব-নিকাশ, ডাটাবেস)  — চলে port 4000-এ
ai/       → AI সার্ভিস (চ্যাট পড়া + রিস্ক স্কোর)    — চলে port 8000-এ
```

### ২.১ Frontend (client ফোল্ডার) — ইউজার যা দেখে

| টেকনোলজি             | এটা কী                                                               | কেন ব্যবহার করেছি                                |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| **Next.js 14**       | React-এর উপর বানানো ফ্রেমওয়ার্ক। পেজ বানানো, রাউটিং সব সহজ করে দেয় | ইন্ডাস্ট্রি স্ট্যান্ডার্ড, দ্রুত ডেভেলপমেন্ট     |
| **TypeScript**       | JavaScript + টাইপ চেকিং। ভুল কোড লেখার আগেই ধরা পড়ে                 | বাগ কমায়, বড় প্রজেক্টে অপরিহার্য               |
| **Tailwind CSS**     | ডিজাইনের জন্য ছোট ছোট class (যেমন `p-4`, `bg-white`)                 | আলাদা CSS ফাইল ছাড়াই সুন্দর, কনসিস্টেন্ট ডিজাইন |
| **Socket.io client** | সার্ভার থেকে **লাইভ আপডেট** আনে                                      | নতুন মেসেজ এলে রিফ্রেশ ছাড়াই স্ক্রিনে দেখায়    |

### ২.২ Backend (server ফোল্ডার) — সব লজিক আর ডাটা

| টেকনোলজি               | এটা কী                                                                                      | কেন                                    |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Node.js + Express**  | JavaScript দিয়ে সার্ভার বানানোর সবচেয়ে জনপ্রিয় উপায়                                     | সহজ, দ্রুত, বিশাল কমিউনিটি             |
| **TypeScript**         | (উপরের মতোই)                                                                                | নিরাপদ কোড                             |
| **Prisma**             | ORM — ডাটাবেসের সাথে কথা বলার সহজ ভাষা। SQL লেখার বদলে `prisma.order.create(...)` লেখা যায় | টাইপ-সেফ ডাটাবেস কোয়েরি               |
| **PostgreSQL**         | ডাটাবেস — সব অর্ডার, কাস্টমার, পেমেন্ট এখানে জমা থাকে                                       | সবচেয়ে নির্ভরযোগ্য ওপেন-সোর্স ডাটাবেস |
| **Socket.io**          | রিয়েল-টাইম যোগাযোগ (WebSocket)                                                             | ইনবক্সে মেসেজ লাইভ আসে                 |
| **JWT (jsonwebtoken)** | লগইন টোকেন — কে লগইন করা আছে তা প্রমাণ করে                                                  | নিরাপদ authentication                  |
| **bcryptjs**           | পাসওয়ার্ড **hash** করে রাখে (আসল পাসওয়ার্ড কখনো জমা হয় না)                               | পাসওয়ার্ড নিরাপত্তা                   |
| **nodemailer**         | ইমেইল পাঠানোর লাইব্রেরি                                                                     | ইমেইল চ্যানেল + ডেইলি ব্রিফিং          |

### ২.৩ AI সার্ভিস (ai ফোল্ডার) — বুদ্ধিমান অংশ

| টেকনোলজি                   | এটা কী                                   | কেন                                              |
| -------------------------- | ---------------------------------------- | ------------------------------------------------ |
| **Python + FastAPI**       | Python-এ API বানানোর আধুনিক ফ্রেমওয়ার্ক | ML/AI-এর জন্য Python-ই সেরা                      |
| **scikit-learn / XGBoost** | মেশিন লার্নিং লাইব্রেরি                  | COD রিস্ক প্রেডিকশন মডেল ট্রেইন করতে             |
| **Gemini API (ঐচ্ছিক)**    | Google-এর AI মডেল                        | বাংলিশ চ্যাট থেকে অর্ডার বের করতে (API key দিলে) |
| **Rule-based NLP**         | নিজেদের লেখা প্যাটার্ন-ম্যাচিং কোড       | Gemini ছাড়াও যেন সব কাজ করে                     |

### ২.৪ অন্যান্য টুল

| টুল                           | কাজ                                                |
| ----------------------------- | -------------------------------------------------- |
| **Docker + docker-compose**   | এক কমান্ডে পুরো সিস্টেম চালু (`docker compose up`) |
| **GitHub Actions**            | প্রতি push-এ অটোমেটিক কোড চেক (CI)                 |
| **Render / Netlify / Vercel** | ফ্রি হোস্টিং — ইন্টারনেটে লাইভ করা                 |
| **node:test**                 | সার্ভারের ১৩টা ইউনিট টেস্ট                         |

---

# ৩. পুরো সিস্টেম কীভাবে কাজ করে (System Architecture)

## ৩.১ উচ্চ-স্তরের আর্কিটেকচার (High-Level Architecture)

```text
                         ┌──────────────────────────────────────────────┐
                         │                  Customer                    │
                         │ Messenger • WhatsApp • Telegram • Web Chat   │
                         └──────────────────┬───────────────────────────┘
                                            │
                                Incoming Message (Webhook)
                                            │
                                            ▼
                         ┌──────────────────────────────────────────────┐
                         │          Meta Graph API / Webhook            │
                         └──────────────────┬───────────────────────────┘
                                            │
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                           Express.js Backend API (Server)                                │
│                                                                                          │
│  • JWT Authentication                                                                    │
│  • Business Logic                                                                        │
│  • Message Processing                                                                    │
│  • Order Management                                                                      │
│  • REST API                                                                              │
│  • Socket.io (Real-time Communication)                                                   │
└───────────────────────┬───────────────────────────────┬──────────────────────────────────┘
                        │                               │
                        │                               │
                        ▼                               ▼
          ┌────────────────────────┐      ┌──────────────────────────────┐
          │     PostgreSQL DB      │      │      FastAPI AI Service      │
          │                        │      │                              │
          │ • Users                │      │ • NLP Parser                 │
          │ • Products             │      │ • Intent Detection           │
          │ • Messages             │      │ • Risk Scoring               │
          │ • Orders               │      │ • AI / ML Models             │
          └────────────────────────┘      └──────────────────────────────┘
                        ▲
                        │
                        │ REST API + Socket.io
                        │
                        ▼
          ┌──────────────────────────────────────────────┐
          │        Next.js Merchant Dashboard            │
          │                                              │
          │ • Live Chat                                  │
          │ • Orders                                     │
          │ • Products                                   │
          │ • Analytics                                  │
          │ • Customer Management                        │
          └──────────────────────────────────────────────┘


───────────────────────────────────────────────────────────────────────────

External Services

• Meta Graph API        → Receive & Send Messages
• Pathao / RedX         → Courier Integration
• Steadfast             → Courier Integration
• bKash / Bangla QR     → Payment Processing
```

---

## ৩.২ মেসেজ ফ্লো (Message Flow)

```text
Customer
    │
    ▼
Messenger / WhatsApp
    │
    ▼
Meta Webhook
    │
    ▼
Express API
    │
    ├────────► Store Message (PostgreSQL)
    │
    ├────────► FastAPI AI
    │              │
    │              ▼
    │      Intent + Entity Detection
    │
    ▼
Business Logic
    │
    ├────────► Create / Update Order
    ├────────► Generate Reply
    ├────────► Notify Merchant
    │
    ▼
Next.js Dashboard (Socket.io)
```

---

## ৩.৩ প্রতিটি কম্পোনেন্টের দায়িত্ব

| Component | Responsibility |
|-----------|----------------|
| **Customer Channels** | Messenger, WhatsApp, Telegram ও Web Chat থেকে মেসেজ পাঠায় |
| **Meta Webhook** | নতুন মেসেজ আমাদের সার্ভারে পাঠায় |
| **Express.js API** | Authentication, Business Logic, Order Processing, API Integration |
| **FastAPI AI** | NLP Parsing, Intent Detection, AI Analysis, Risk Scoring |
| **PostgreSQL** | Users, Messages, Products, Orders ও Conversations সংরক্ষণ করে |
| **Next.js Dashboard** | Merchant-এর জন্য Live Chat, Orders, Analytics ও Customer Management |
| **External Services** | Payment Gateway, Courier এবং Meta API Integration |

---

## ৩.৪ Graceful Fallback Architecture

এই সিস্টেমের সবচেয়ে গুরুত্বপূর্ণ ডিজাইন সিদ্ধান্ত হলো **Graceful Fallback**।

যদি কোনো একটি সার্ভিস সাময়িকভাবে বন্ধ হয়ে যায়, তাহলে পুরো সিস্টেম বন্ধ না হয়ে বিকল্প ব্যবস্থা ব্যবহার করে কাজ চালিয়ে যায়।

### AI Service Down

```text
Express API
      │
      ├────────► FastAPI Available?
      │
      ├── Yes ─► AI Parser
      │
      └── No ──► Built-in TypeScript Parser
```

FastAPI AI সার্ভিস বন্ধ থাকলেও Express API-এর ভেতরে থাকা TypeScript ভিত্তিক Parser এবং Risk Scoring Engine স্বয়ংক্রিয়ভাবে কাজ শুরু করে। ফলে Message Parsing এবং Order Detection বন্ধ হয় না।

---

### External API Down

```text
Courier / Payment API
        │
        ├── Connected ─► Real API
        │
        └── Offline ───► Built-in Simulator
```

যদি Courier অথবা Payment Gateway-এর API Key না থাকে অথবা সার্ভিস সাময়িকভাবে অকার্যকর হয়, তাহলে Built-in Simulator ব্যবহার করে ডেমো স্বাভাবিকভাবে চলতে থাকে।


## ফলাফল

- ✅ AI Service বন্ধ হলেও সিস্টেম সচল থাকে।
- ✅ Courier API না থাকলেও Demo চালানো যায়।
- ✅ Payment Gateway না থাকলেও Flow সম্পূর্ণ দেখা যায়।
- ✅ কোনো অবস্থাতেই Presentation বা Demo ভেঙে যায় না।
- ✅ Production এবং Demo — উভয় পরিবেশেই একই Architecture ব্যবহার করা যায়।

---
## ৪. ফিচারগুলো কীভাবে কাজ করে (কোডসহ ব্যাখ্যা)

### ৪.১ লগইন ও Multi-tenancy (একাধিক দোকান, আলাদা ডাটা)

- রেজিস্টার করলে একটা **Tenant** (দোকান) + একজন **OWNER** ইউজার তৈরি হয়
- পাসওয়ার্ড bcrypt দিয়ে hash হয়ে জমা থাকে
- লগইন করলে ২টা **JWT টোকেন** httpOnly cookie-তে সেট হয় (accessToken ১৫ মিনিট, refreshToken ৭ দিন)
- **নিয়ম:** ডাটাবেসের প্রতিটা টেবিলে `tenantId` কলাম আছে, আর প্রতিটা query-তে
  `where: { tenantId }` দেওয়া — তাই এক দোকান আরেক দোকানের ডাটা **কখনোই** দেখতে পারে না
- কোড: `server/src/routes/auth.routes.ts`, `server/src/middleware/auth.ts`

### ৪.২ Unified Inbox (৭টা চ্যানেল এক জায়গায়)

- Messenger, Instagram, WhatsApp, Telegram, Viber, ওয়েবসাইট চ্যাট, ইমেইল — সব মেসেজ এক ইনবক্সে
- **কীভাবে:** প্রতিটা প্ল্যাটফর্ম মেসেজ এলে আমাদের **webhook** (একটা বিশেষ URL)-এ POST করে।
  আমরা signature যাচাই করি (কেউ ভুয়া মেসেজ পাঠাতে পারবে না), তারপর সব প্ল্যাটফর্মের
  ভিন্ন ভিন্ন ফরম্যাটকে **একটাই ফরম্যাটে** রূপান্তর করি (`webhook-normalize.ts`)
- Socket.io দিয়ে মেসেজটা **লাইভ** ড্যাশবোর্ডে পৌঁছে যায় — রিফ্রেশ লাগে না
- Quick reply টেমপ্লেট আছে — `{customer}`, `{shop}` লিখলে নিজে থেকে নাম বসে যায়
- কোড: `server/src/routes/inbox.routes.ts`, `services/channels.ts`, `client/src/app/dashboard/inbox/page.tsx`

### ৪.৩ AI অর্ডার পার্সিং (চ্যাট → অর্ডার ফর্ম)

- কাস্টমার লিখল: _"Ok 2 ta nibo. Amar number 01712345678. Address: House 12, Dhanmondi, Dhaka"_
- **Extract Order** বাটনে ক্লিক করলেই AI বের করে দেয়: ফোন, ঠিকানা, জেলা, পণ্য, পরিমাণ
- **কীভাবে:** Gemini API key থাকলে Google-এর AI ব্যবহার হয়; না থাকলে নিজেদের লেখা
  rule-based পার্সার: regex দিয়ে ফোন নম্বর (`01[3-9]\d{8}`), ৬৪ জেলার তালিকা মিলিয়ে জেলা,
  দোকানের ক্যাটালগ মিলিয়ে পণ্য খোঁজা হয়। বাংলা সংখ্যা (০১৭...) ইংরেজিতে রূপান্তরও হয়
- AI যেসব ফিল্ডে অনিশ্চিত, সেগুলো ফর্মে **হলুদ হাইলাইট** হয় — মানুষ যাচাই করে নেয়
- কোড: `ai/app/parser.py`, fallback: `server/src/services/aiParser.ts`

### ৪.৪ ইনভেন্টরি — Double-selling অসম্ভব (সবচেয়ে গর্বের কোড!)

- সমস্যা: শেষ ১টা পণ্য, ২ জন এজেন্ট **একই মুহূর্তে** ২টা অর্ডার কনফার্ম করল — দুটোই সফল হলে বিপদ!
- সমাধান: **atomic conditional update** — ডাটাবেসকে এক লাইনে বলা হয়:
  ```
  UPDATE Product SET stock = stock - 2
  WHERE id = ... AND stock >= 2      ← শর্তটাই আসল কথা
  ```
  ডাটাবেস নিজেই নিশ্চিত করে মাত্র **একজন** সফল হবে; অন্যজন পাবে "স্টক নেই" এরর
- স্টক কমে reorder-লেভেলে নামলে **লাইভ অ্যালার্ট** + সাইডবারে ব্যাজ
- কোড: `server/src/routes/order.routes.ts` (confirm endpoint)

### ৪.৫ অর্ডার লাইফসাইকেল (State Machine)

```
DRAFT → CONFIRMED → DISPATCHED → DELIVERED
   └→ CANCELLED        └→ RETURNED
```

- ভুল লাফ (যেমন DRAFT → DELIVERED) সার্ভার **reject** করে
- বাতিল/ফেরত হলে স্টক **অটোমেটিক ফেরত** যায়
- প্রতিটা ঘটনার **timeline** থাকে (কখন কনফার্ম, কখন পেমেন্ট — সব)

### ৪.৬ COD রিস্ক স্কোর (মেশিন লার্নিং)

- প্রতিটা অর্ডার কনফার্মের সময় **০-১০০ স্কোর** পায়: এই ডেলিভারি ব্যর্থ হওয়ার সম্ভাবনা কত?
- **মডেল কী দেখে:** ফোন নম্বর সঠিক কি না, ঠিকানা সম্পূর্ণ কি না, কাস্টমারের আগের
  return-এর ইতিহাস, জেলাভিত্তিক return-এর হার
- **XGBoost** মডেল ১০,০০০ নমুনা ডাটায় ট্রেইন করা; ট্রেইনিং স্ক্রিপ্ট **AUC ≥ 0.78** না হলে
  মডেল সেভই করে না (কোয়ালিটি গেট)
- স্কোর বেশি হলে (ডিফল্ট ৬০+) লাল ব্যানার: **"২০% অগ্রিম নিন"** — এক ক্লিকে কাস্টমারের
  চ্যাটে পেমেন্ট লিংক চলে যায়
- কোড: `ai/app/risk.py`, `ai/train/train_model.py`, fallback: `server/src/services/risk-rules.ts`

### ৪.৭ কুরিয়ার বুকিং

- Pathao, RedX, Steadfast, Paperfly-এর **ভাড়া তুলনা** → এক ক্লিকে বুকিং → ট্র্যাকিং কোড →
  প্রিন্টযোগ্য **শিপিং লেবেল**
- প্রতিটা কুরিয়ার একটা **Adapter class** — আসল API credential দিলে আসল বুকিং হয়,
  না দিলে মক (নকল) চলে। নতুন কুরিয়ার যোগ করা মানে শুধু একটা নতুন class লেখা
- ট্র্যাকিং ৩ ভাবে আপডেট হয়: webhook (তাৎক্ষণিক), ব্যাকগ্রাউন্ড পোলার (প্রতি ৩ মিনিটে), ম্যানুয়াল সিঙ্ক বাটন
- কোড: `server/src/services/couriers.ts`, `tracker.ts`

### ৪.৮ পেমেন্ট ও লেজার (টাকার হিসাব)

- **Bangla QR** ইনভয়েস তৈরি → কাস্টমার স্ক্যান করে পে করে (ডেমোতে "Simulate payment" বাটন)
- আসল **bKash** স্যান্ডবক্স চেকআউটও আছে (credential দিলে)
- পেমেন্ট এলে **এক atomic transaction-এ** ৩টা কাজ হয়: ইনভয়েস paid + লেজারে এন্ট্রি + অর্ডার আপডেট
- **Idempotent:** একই transaction ID দুইবার এলে (bKash মাঝেমধ্যে করে) দ্বিতীয়বার **কিছুই হয় না** — টাকা দুইবার জমা হওয়া অসম্ভব
- হিসাব: ১% MDR ফি + ফির উপর ১৫% ভ্যাট, সব **সঠিক ২ দশমিক পর্যন্ত**
- কোড: `server/src/services/payments.ts`, `routes/payment.routes.ts`, `routes/pay.routes.ts`

### ৪.৯ অন্যান্য ফিচার

| ফিচার                     | কী করে                                                       |
| ------------------------- | ------------------------------------------------------------ |
| **Analytics পেজ**         | দিন/পণ্য/জেলা-ভিত্তিক বিক্রির চার্ট                          |
| **Customers পেজ**         | সব কাস্টমার + অর্ডার সংখ্যা, return রেট, মোট খরচ             |
| **Ads পেজ**               | কোন বিজ্ঞাপন থেকে কত টাকার অর্ডার এলো (attribution)          |
| **Team**                  | OWNER নতুন AGENT যোগ করতে পারে; এজেন্টরা ইনবক্স ভাগ করে নেয় |
| **Order notes**           | অর্ডারে internal নোট (শুধু টিম দেখে)                         |
| **Receipt/Label প্রিন্ট** | ব্রাউজার থেকেই PDF                                           |
| **Away message**          | ব্যবসার সময়ের বাইরে মেসেজ এলে অটো-রিপ্লাই                   |
| **CSV export**            | অর্ডার ও লেজার ডাউনলোড                                       |
| **Responsive**            | মোবাইলেও পুরো ড্যাশবোর্ড চলে (hamburger মেনু)                |

---

## ৫. কোড কোথায় কী আছে (ফোল্ডার গাইড)

```
F_comFlow/
├── client/src/
│   ├── app/dashboard/        ← প্রতিটা পেজ (inbox, orders, analytics...)
│   ├── app/pay/[invoiceId]/  ← কাস্টমারের পাবলিক পেমেন্ট পেজ
│   ├── components/ui.tsx     ← Button, Card, Modal — সব শেয়ার্ড UI
│   └── lib/api.ts            ← সার্ভারের সাথে কথা বলার হেল্পার
│
├── server/
│   ├── prisma/schema.prisma  ← ডাটাবেসের ১২টা টেবিলের নকশা
│   ├── prisma/seed.ts        ← ডেমো ডাটা (demo@fcomflow.com)
│   └── src/
│       ├── routes/           ← ১৯টা ফাইল — প্রতিটা ফিচারের API endpoint
│       ├── services/         ← মূল ব্যবসায়িক লজিক (কুরিয়ার, পেমেন্ট, রিস্ক...)
│       ├── middleware/       ← auth (JWT যাচাই), rate limit
│       └── __tests__/        ← ১৩টা ইউনিট টেস্ট
│
├── ai/
│   ├── app/                  ← FastAPI: parser.py, risk.py, districts.py
│   └── train/                ← ডাটাসেট বানানো + মডেল ট্রেইনিং
│
├── presentation/index.html   ← অফলাইন ডেমো (ইন্টারনেট ছাড়াই পুরো ট্যুর)
├── docs/                     ← সব ডকুমেন্টেশন
└── docker-compose.yml        ← এক কমান্ডে সব চালু
```

---

## ৬. গুরুত্বপূর্ণ কনসেপ্টগুলো এক লাইনে (ভাইভা/প্রশ্নোত্তরের জন্য)

| টার্ম                   | সহজ মানে                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| **REST API**            | সার্ভারের সাথে কথা বলার নিয়ম — GET (আনো), POST (তৈরি করো), PATCH (বদলাও)       |
| **Webhook**             | উল্টো API — _ওরা আমাদের_ ডাকে; মেসেজ এলে Meta আমাদের URL-এ POST করে             |
| **JWT**                 | সিলমোহর করা টোকেন — সার্ভার চিনতে পারে কে লগইন করা, প্রতিবার পাসওয়ার্ড লাগে না |
| **httpOnly cookie**     | এমন কুকি যা JavaScript পড়তে পারে না — টোকেন চুরি ঠেকায়                        |
| **ORM (Prisma)**        | SQL না লিখে কোডের ভাষায় ডাটাবেস চালানো                                         |
| **Atomic transaction**  | কয়েকটা ডাটাবেস কাজ হয় **সব একসাথে** সফল, নয় **সব বাতিল** — মাঝামাঝি নেই      |
| **Idempotent**          | একই কাজ ১০ বার করলেও ফলাফল ১ বারের সমান (পেমেন্ট ডাবল হয় না)                   |
| **WebSocket/Socket.io** | সার্ভার নিজে থেকে ব্রাউজারে খবর পাঠাতে পারে (লাইভ আপডেট)                        |
| **HMAC signature**      | গোপন চাবি দিয়ে বানানো সিল — webhook টা আসলেই Meta পাঠিয়েছে কি না যাচাই হয়    |
| **Multi-tenant**        | এক সফটওয়্যারে বহু দোকান, কিন্তু প্রত্যেকের ডাটা সম্পূর্ণ আলাদা                 |
| **AUC**                 | ML মডেলের মান যাচাইয়ের স্কোর (১-এর যত কাছে তত ভালো; আমাদের ≥ 0.78)             |
| **Fallback**            | মূল জিনিস কাজ না করলে বিকল্প নিজে থেকে চালু হওয়া                               |
| **State machine**       | নির্দিষ্ট নিয়মে অবস্থা বদলানো — DRAFT থেকে সরাসরি DELIVERED যাওয়া নিষেধ       |

---

## ৭. কীভাবে চালাবো?

**সবচেয়ে সহজ (Docker):**

```
copy .env.example .env
docker compose up -d --build
docker compose exec server npm run db:seed
```

তারপর ব্রাউজারে `http://localhost:3000` → লগইন: `demo@fcomflow.com / demo1234`

**ডেভেলপার মোড:** README.md-তে ৪টা টার্মিনালের নির্দেশনা আছে।
**ইন্টারনেট ছাড়া ডেমো:** `presentation/index.html` ডাবল-ক্লিক করলেই চলে।

---

## ৮. কোয়ালিটির প্রমাণ

- **১৩/১৩ ইউনিট টেস্ট পাস** (`cd server && npm test`)
- **সম্পূর্ণ type-safe** — client ও server দুটোই TypeScript, AI সার্ভিস Pydantic
- **CI pipeline** — GitHub-এ push করলেই অটোমেটিক টাইপ-চেক ও বিল্ড
- **ডাটাবেস হেলথ-চেক কমান্ড** — `npm run db:check`
- প্রতিটা বিপজ্জনক জায়গায় সুরক্ষা: race condition (atomic stock), ডাবল পেমেন্ট (idempotency),
  ভুয়া webhook (HMAC), টেন্যান্ট ডাটা লিক (tenantId scoping), পাসওয়ার্ড (bcrypt hash)

---

_ফাইলটি F-ComFlow প্রজেক্টের অংশ — CSE Fest 2026 Software Project Showcase-এর জন্য প্রস্তুতকৃত।_
