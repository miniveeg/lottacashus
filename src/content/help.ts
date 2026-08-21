export type FaqItem = { question: string; answer: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is LottaCash?",
    answer:
      "LottaCash is an online casino platform with a single-currency wallet using Sweeps Coins (SC). SC can be used to play all games and can be redeemed for real crypto. House originals (Keno, Mines, Limbo, Roulette, Blackjack, Case Battles, Crash, and Slots) are live now — your account, balance, stats, and level carry across every game.",
  },
  {
    question: "What are Sweeps Coins (SC)?",
    answer:
      "Sweeps Coins (SC) are the only currency on LottaCash. They are redeemable for real money at a rate of 1 SC = $0.01 USD (100 SC = $1), with a minimum redemption of 100 SC ($1). You receive SC when you deposit crypto, and you can also earn SC through promotions.",
  },
  {
    question: "How do I create an account?",
    answer:
      "Click Sign up, choose a username (up to 16 characters), enter your email, and set a password. We send a 6-digit verification code to your email; enter it within 10 minutes to activate your account. New accounts receive a welcome bonus of SC. You can reset your password from the forgot-password page if needed.",
  },
  {
    question: "How do deposits work?",
    answer:
      "Open Deposit while logged in. You receive unique deposit addresses for SOL, LTC, and ETH. Send crypto to your address; once the transaction reaches the required confirmations, your SC balance is credited at 100 SC per $1 USD. You can track activity in Settings and notifications.",
  },
  {
    question: "How do withdrawals work?",
    answer:
      "Open Withdraw, choose a chain (SOL, LTC, or ETH), enter a valid destination wallet address, and redeem Sweeps Coins (SC) for crypto. Minimum is 100 SC ($1 USD). The SC is reserved while the request is pending; payouts are sent from our treasury after review, typically within 3–5 business days.",
  },
  {
    question: "How do I redeem Sweeps Coins (SC)?",
    answer:
      "Go to Withdraw, enter the amount of SC to cash out (minimum 100 SC = $1 USD), choose SOL, LTC, or ETH, enter your destination address, and submit. The exchange rate is fixed at 1 SC = $0.01 USD (100 SC = $1).",
  },
  {
    question: "How does leveling work?",
    answer:
      "Your level (0–100) is based on lifetime SC wagered. Early levels require relatively little volume; later levels require much more. Level 100 is designed around $500,000 total SC wagered. View your level and progress in the top bar or under Account in Settings.",
  },
  {
    question: "Can I link Discord?",
    answer:
      "Yes. In Settings, use Link Discord to connect your account for future rewards and community perks when the official LottaCash Discord launches. You can unlink at any time from the same page.",
  },
  {
    question: "Why did my balance change without playing?",
    answer:
      "Deposits increase your SC balance; withdrawals decrease it. Pending withdrawals reserve funds until completed or failed. Wagers and wins from house originals update your balances, wager stats, and level shown in Settings.",
  },
  {
    question: "Is there a minimum withdrawal / redemption?",
    answer:
      "Yes. SC redemptions require a minimum of 100 SC ($1 USD). Requests are subject to review and processing times.",
  },
  {
    question: "Who can use LottaCash?",
    answer:
      "You must be at least 18 years old (or the legal age for online gaming in your jurisdiction, whichever is higher) and located where use of the service is permitted by law. You are responsible for complying with local regulations.",
  },
  {
    question: "How do house originals work?",
    answer:
      "Each game settles on the server using provably fair seeds (server hash, client seed, and nonce). Open any original while logged in to play. Keno, Mines, Limbo, Roulette, Blackjack, Crash, and Slots use your personal PF settings; Case Battles use EOS block hashes for battle randomness. Fairness details are shown in each game.",
  },
  {
    question: "How do I get support?",
    answer:
      "For account, deposit, or withdrawal issues, contact support@lottacash.us from the email on your account. Include your username and a clear description of the problem. We aim to respond as quickly as possible.",
  },
];

export const TERMS_OF_SERVICE = `
Last updated: August 20, 2026

1. Acceptance of terms
By accessing or using LottaCash ("the Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service.

2. Eligibility
You must be at least 18 years old or the minimum legal age in your jurisdiction, whichever is greater. You represent that you are legally permitted to use online gaming services where you are located. We may request proof of age or identity at any time.

3. Account registration
You must provide accurate information when registering. You are responsible for safeguarding your login credentials and for all activity under your account. Usernames may not exceed 16 characters. One account per person unless we approve otherwise in writing.

4. Single-currency model
The Service uses a single currency: Sweeps Coins (SC). SC are redeemable for real money at the rate of 1 SC = $0.01 USD (100 SC = $1), subject to a minimum redemption of 100 SC ($1). Balances are displayed in your account.

5. Wallet and balances
Sweeps Coin balances are displayed as SC units. Deposits are credited after blockchain confirmations at rates determined at the time of credit (100 SC per $1 USD). Withdrawals and SC redemptions are subject to minimum amounts, review, and processing times. We may delay or refuse transactions suspected of fraud, error, or legal risk.

6. Crypto deposits and withdrawals
You are solely responsible for sending assets to the correct address and network. Transactions sent to wrong addresses or chains may be unrecoverable. Network fees and confirmation times are outside our control.

7. Wagering and leveling
Levels are calculated from lifetime SC wager volume. Levels may be adjusted if we detect abuse, collusion, or technical errors.

8. Prohibited conduct
You may not: use the Service where prohibited by law; launder funds; use bots or exploits; create multiple accounts to abuse promotions; harass staff or other users; or attempt to compromise the platform. We may suspend or terminate accounts and withhold balances involved in violations, subject to applicable law.

9. Responsible play
Gambling can be addictive. Set limits, take breaks, and seek help if needed. We may offer cooling-off or self-exclusion tools as the product matures.

10. Intellectual property
The LottaCash name, branding, software, and content are owned by us or our licensors. You receive a limited, revocable license to use the Service for personal entertainment.

11. Disclaimers
The Service is provided "as is" without warranties of uninterrupted access, error-free operation, or fitness for a particular purpose. Gaming involves risk of loss.

12. Limitation of liability
To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages, or for losses arising from blockchain delays, user error, unauthorized account access, or force majeure. Our aggregate liability for any claim is limited to the fees you paid us in the twelve months before the claim, or one hundred USD, whichever is greater.

13. Changes
We may update these Terms or the Service at any time. Material changes will be posted on this page. Continued use after changes constitutes acceptance.

14. Termination
You may stop using the Service at any time. We may suspend or close accounts for breach of these Terms or legal requirements. Upon termination, you may request withdrawal of eligible balances subject to verification and applicable holds.

15. Governing law and disputes
These Terms are governed by the laws applicable to the operator of LottaCash, without regard to conflict-of-law rules. Disputes shall be resolved in the courts or arbitration forum designated by us, unless mandatory consumer protections in your country require otherwise.

16. Contact
Questions about these Terms: support@lottacash.us
`.trim();
