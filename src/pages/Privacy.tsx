export function Privacy() {
  return (
    <article className="legal">
      <h1>Privacy</h1>
      <p>
        LottaCash.us stores the minimum needed to run a casino: account id, SC balance, game round history, and a client
        seed you can edit. Demo mode keeps balance and seeds in localStorage on your device only.
      </p>
      <h2>Live mode</h2>
      <p>
        When Supabase is configured we process email, auth tokens, and round records on that project. We do not sell
        personal data. Deposit addresses and tx hashes you paste are used to credit SC, not to custody keys — we never ask
        for mnemonics or private keys.
      </p>
      <h2>Cookies</h2>
      <p>Auth session cookies / local storage via Supabase. No third-party ad pixels in this app.</p>
      <p>Questions: privacy@lottacash.us</p>
    </article>
  );
}
