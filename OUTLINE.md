# LottaCash — Site Outline

## Brand

**LottaCash** is a premium online gambling platform covering casino, live dealer, and sports betting under one account and wallet.

---

## Color scheme

| Role | Token | Hex | Usage |
|------|--------|-----|--------|
| Base background | `--lc-bg-base` | `#07080c` | Page canvas |
| Elevated surfaces | `--lc-bg-elevated` | `#0d0f14` | Topbar, sidebar |
| Panels / cards | `--lc-bg-panel` | `#12151c` | Cards, search, balance |
| Hover | `--lc-bg-hover` | `#1a1e28` | Interactive states |
| Primary accent | `--lc-gold` | `#f5b942` | Brand, CTAs, highlights |
| Gold dim | `--lc-gold-dim` | `#c9922a` | Gradients, borders |
| Success / balance | `--lc-emerald` | `#22c55e` | Balance, deposit CTAs |
| Alert / live | `--lc-ruby` | `#ef4444` | Badges, live indicators |
| Accent alt | `--lc-violet` | `#8b5cf6` | Future VIP / promos |
| Primary text | `--lc-text-primary` | `#f4f4f5` | Headings, body |
| Secondary text | `--lc-text-secondary` | `#a1a1aa` | Descriptions |
| Muted text | `--lc-text-muted` | `#71717a` | Labels, placeholders |

**Typography:** Outfit (display/headings), DM Sans (UI/body).

**Mood:** Dark luxury casino — gold on charcoal, emerald for money/trust.

---

## Layout structure

```
┌─────────────────────────────────────────────────────────────┐
│  TOPBAR (full width, 64px) — logo, search, balance, auth   │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│   SIDEBAR    │              MAIN CONTENT                    │
│   (240px)    │              (scrollable home + pages)       │
│   sticky     │                                              │
│   below      │                                              │
│   topbar     │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **Topbar:** spans entire viewport width; sticky at top.
- **Sidebar:** starts directly under the topbar; fixed height `100vh - topbar`; scrolls independently if nav grows.
- **Main:** fills remaining space to the right of the sidebar.

Grid implementation: `src/styles/layout.css` + `AppShell` component.

---

## Pages (planned)

| Page | Route | Status |
|------|-------|--------|
| Home | `/` | ✅ Built (hero, categories, featured, live, stats) |
| Casino | `/casino` | Planned |
| Live Casino | `/live` | Planned |
| Sports | `/sports` | Planned |
| Originals | `/originals` | Planned |
| Promotions | `/promotions` | Planned |
| Wallet | `/wallet` | Planned |
| Bet History | `/history` | Planned |
| VIP Club | `/vip` | Planned |
| Help | `/help` | Planned |
| Auth (login / signup) | `/login`, `/signup` | Planned (topbar CTAs) |

---

## Home page sections (current)

1. **Hero** — welcome offer, primary CTA, secondary CTA  
2. **Quick categories** — Slots, Blackjack, Roulette, Sports, Live, Dice  
3. **Featured games** — grid of placeholder game cards  
4. **Live casino** — subset grid with live label  
5. **Stats strip** — game count, tables, markets, support  

---

## Topbar (current)

- Brand logo + “LottaCash”
- Global search
- Balance display
- Log in / Sign up
- Notifications

---

## Sidebar (current)

**Play:** Home, Casino, Live Casino (live badge), Sports, Originals, Promotions  

**Account:** Wallet, Bet History, VIP Club, Help  

**Footer promo:** Welcome bonus card + claim CTA  

---

## Tech stack

- React 19 + TypeScript  
- Vite 6  
- CSS modules via co-located `.css` files + design tokens in `theme.css`  

---

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).
