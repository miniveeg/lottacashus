export function Terms() {
  return (
    <article className="legal">
      <h1>Terms</h1>
      <p>
        By using LottaCash you agree that games are games of chance with a published house edge, that SC has no cash value
        unless a cashier explicitly redeems it, and that we may void rounds that fail fairness checks or look automated
        against the spirit of the tables.
      </p>
      <h2>House edge</h2>
      <p>
        Mines, Tower, Limbo ~1%. Roulette 2.70% European. Blackjack with 3:2 and six decks is standard. Upgrader 3%. Cases
        and battles return about 96–98% of stake.
      </p>
      <h2>Provably fair</h2>
      <p>
        Each round commits a SHA-256 hash of a server seed, then reveals the seed after. HMAC-SHA256(server, client:nonce)
        maps to a float in [0, 1). You may change your client seed between rounds.
      </p>
      <h2>Law</h2>
      <p>
        You are responsible for whether online play is legal where you live. We do not offer play to persons in
        jurisdictions that prohibit it. 18+ only.
      </p>
    </article>
  );
}
