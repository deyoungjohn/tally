# Tally design system (`DESIGN.md`)

Tally's UI is meant to be one of the project's main strengths. This file is the single source of truth for how it looks and moves. Every screen, every component and the Telegram Mini App are built from these tokens. Don't hard-code a colour, radius, shadow or duration that isn't defined here. If something is missing, add it here first.

**Current direction (owner, 2026-10-06 "Round 6", palette rule 2026-10-07):** a black page with one fixed orange glow behind everything, liquid-glass surfaces on top, **orange** buttons, pills, highlights and important words with white text. **The palette is black, white, faint white (white at lower opacity) and orange. There are no greys**: no solid grey fill, no grey text, no grey highlight, no metallic silver. Text steps down from white by opacity; surfaces are black or faint white glass; every hover, selected and pressed highlight is orange glass. If a sentence anywhere still says otherwise, this paragraph and section 2.1 win and the sentence is a bug to fix here.

**Inspiration and attribution**
- **Base look: [revenue.family](https://revenue.family).** Black, frosted-glass cards, rounded pills, floating shapes. The values below were taken from its public stylesheet (`assets/site.css?v=42`, fetched 2026-10-01) and from the full-page screenshot in `spike/revenue-family-landing-page.png`. Its silver metallic buttons were replaced by orange ones in Round 6.
- **Colour and background (Round 6): a Dribbble crypto-trading landing design** (black, a single orange spotlight at the top, orange pills and buttons, dark glass cards). The owner's reference image is `docs/design/landing-reference.webp`; the background is `apps/web/public/bg-glow.webp`. The full-page design is the template for the landing page, which is built last (5.1).
- **Motion: [Linear](https://linear.app)** for crisp entrances, blur-in reveals, staggered lists and glow on hover, plus **[Mercury](https://mercury.com)** for subtle motion: counting numbers, gentle parallax, calm hover lift.
- **Components: [beUI](https://beui.dev)**, via the BeUI MCP connector. These are shadcn-style React components using Tailwind, `motion/react`, `clsx` and `tailwind-merge`.

> **We borrow the style, not the brand.** Never copy Revenue's logo (the zebra), product name, copy text, illustrations or images. Recreate effects such as glass, spheres and beams with our own CSS, SVG or canvas.

---

## 1. Principles
1. **Money app first, crypto second.** Big, calm numbers; plain words ("shares", "price per share", "you pay"); no jargon on the main path. Tickers, contract addresses and hashes appear only where people look for them, in monospace.
2. **Glass gives depth, not decoration.** Glass surfaces hold content (quotes, receipts, portfolios). Background effects stay quiet, so the numbers stay legible.
3. **Black and white, with one orange accent.** Surfaces are black or faint white glass, text is white or faint white. Orange marks what you can act on or should notice (and is every hover, selected and pressed highlight) (buttons, pills, selected toggle, "Learn more", an important word). Every other colour still says something: up/cheaper (green), down/costly or error (red), warning (amber), info (blue). Orange is never used for price direction.
4. **Motion explains state changes.** Price updates roll, quotes re-sort with a glide, a trade animates through its steps. Ambient motion (float, drift) is slow and turns off with reduced motion.
5. **Same quality on a 375px phone and a 1440px desktop.** Design mobile first, then enhance.

---

## 2. Tokens

### 2.1 Colour (CSS custom properties)
These are Revenue's values with Tally additions marked ★. Put them in `app/globals.css` under `:root`. The app is dark-only; `color-scheme: dark`.

```css
:root {
  /* black and white: the only two solid colours */
  --black: #000000;   /* page base, html background, <meta name="theme-color"> */
  --white: #ffffff;
  --g0: #000000;      /* legacy names, both pure black: nothing is a grey */
  --g1: #000000;

  /* text: white, then white at lower opacity ("faint white") */
  --fg:  #ffffff;                      /* primary text */
  --fg2: rgba(255,255,255,.76);        /* secondary text */
  --fg3: rgba(255,255,255,.58);        /* ★ small meta text, 12px and up */
  --fg-disabled: rgba(255,255,255,.40);/* disabled or decorative only */

  /* edges */
  --edge:  rgba(255,255,255,.14);
  --edge2: rgba(255,255,255,.24);

  /* ★ highlight: hover, selected and pressed items (orange glass, never a grey fill) */
  --hl:        rgba(240,78,19,.26);
  --hl-edge:   rgba(255,131,80,.50);
  --hl-strong: rgba(240,78,19,.46);    /* the pressed state */

  /* white accent (kept under the old --silver names): primary white buttons, kickers, slider fill */
  --silver-1: #ffffff;
  --silver-2: rgba(255,255,255,.76);
  --silver-ink: #000000;               /* text on white surfaces (.btn-light) */
  --silver-glow: rgba(255,255,255,.22);
  --silver: #ffffff;

  /* ★ orange accent (Round 6): buttons, pills, selected toggle, "Learn more", highlighted words. White text on orange. */
  --orange:      #f04e13;
  --orange-hi:   #ff7a3d;                  /* top of the button gradient */
  --orange-text: #ff8350;                  /* orange used AS TEXT on dark (links, .hl): 7.1–8.6:1 */
  --orange-glow: rgba(255,106,40,.38);     /* button glow */

  /* semantic */
  --amber: #f2c14e;   /* warnings, "earnings: limited" */
  --red:   #ff6b6b;   /* errors, "costs more", paused */
  --blue:  #6aa9ff;   /* links, info */
  --up:    #3ddc97;   /* ★ "cheaper", price up, success: on black */

  /* layout */
  --r: 22px;          /* default card radius */
  --w: 1180px;        /* content max width */
  --ease: cubic-bezier(.2,.8,.2,1);
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  color-scheme: dark;
}
```

**Mapping for BeUI / shadcn components.** BeUI components read shadcn variable names (`--foreground`, `--card`, `--border`, `--muted-foreground`, ...). Point them at our tokens so every BeUI component inherits the look automatically:

| shadcn variable | Tally value |
|---|---|
| `--background` | `var(--g0)` |
| `--foreground` | `var(--fg)` |
| `--card` / `--popover` | `rgba(255,255,255,.05)` / `rgba(0,0,0,.58)` (glass surfaces override with the glass recipe) |
| `--card-foreground` / `--popover-foreground` | `var(--fg)` |
| `--primary` | `var(--silver-1)` (white) |
| `--primary-foreground` | `var(--silver-ink)` |
| `--secondary` / `--muted` / `--accent` | `rgba(255,255,255,.10)` (**`--accent` is the shadcn name and stays faint white**: the orange tokens are `--orange*`, never `--accent`) |
| `--muted-foreground` | `var(--fg2)` |
| `--border` / `--input` | `var(--edge)` |
| `--ring` | `var(--edge2)` |
| `--destructive` | `var(--red)` |
| `--radius` | `22px` |

**Pop-up surfaces.** Modals, bottom sheets, menus (the account menu), dropdowns (Select and the search panel), tooltips and the progress island are not grey. They use `--pop-bg` (`.glass-pop`, `.select-panel`, `.tip`, `.glass-solid`, `.island-glass` in `globals.css`): the same liquid glass as the nav bar (blur and a faint white sheen) over `rgba(0,0,0,.58)` black, so the text on them stays legible over the bright background. Never give a pop-up a solid fill, and never override its background from a component (`!bg-…`): that is how a modal once stayed grey.

**Highlights.** Hover, the selected item and the pressed item all use the gliding orange pill (`.glide-pill`: `--hl` fill with a `--hl-edge` hairline; `--hl-strong` while pressed), or `--hl` as a plain fill on a one-off item. A faint-white fill over a black surface reads as grey, so it is only used for resting surfaces (cards, panels, chips), never for hover, selected or pressed.

**Contrast rules.**
- `--fg` and `--fg2` are safe everywhere.
- `--fg3` is for meta text at 12px and up.
- `--fg-disabled` never carries information.
- On white surfaces (`.btn-light`) use `--silver-ink` (black).
- On orange buttons and pills the text is white (3.6:1 on `--orange`, which meets AA only for large or bold text): orange controls use 15.5px/600 or heavier, never light small text. Orange *text* on dark is `--orange-text`, not `--orange`.
- Colour is never the only signal: "cheaper" also gets a ▼ or a "best" label, "paused" also gets an icon.

### 2.2 Typography
- **Weight and size (Round 3):** body text is weight **500** and every size in the Tailwind text scale is **+1px** over the original design (the table below shows the current values).
- **Families:** Inter (400, 500, 600, 700, 800) and JetBrains Mono (500). Load with `next/font/google`. Enable Inter's `cv11` stylistic set: `font-feature-settings: "cv11"`.
- **Numbers:** every price, amount, share count and percentage uses `font-variant-numeric: tabular-nums`, so digits don't jump while they animate.
- **Monospace** is for contract addresses, tx hashes, quote IDs and invite/link codes only.

| Role | Size | Weight | Letter spacing | Line height | Notes |
|---|---|---|---|---|---|
| Display (hero h1) | `clamp(41px, 6vw, 77px)` | 800 | −0.05em | 0.96 | Fade gradient on the last line (below) |
| h2 (section) | `clamp(29px, 4vw, 43px)` | 750 | −0.035em | 1.1 | |
| h3 (card title) | 22px | 700 | −0.02em | 1.15 | |
| Big number (quote, balance) | `clamp(37px, 5vw, 57px)` | 700 | −0.03em | 1 | tabular-nums |
| Body | 16px | 500 | 0 | 1.55 | `--fg` or `--fg2` |
| Lead paragraph | 19px | 500 | 0 | 1.6 | `--fg2` |
| UI label / button | 15.5px | 600 | −0.1px | 1 | |
| Eyebrow (pill above a heading) | 14px | 500 | 0 | 34px pill | Glass pill, `<b>` in `--fg` |
| Kicker ("INVITES", "FAQ") | 13.5px | 600 | 0.12em, uppercase | | `--silver-1` (white) |
| Footer heading | 13px | 600 | 0.09em, uppercase | | `--fg3` |
| Meta / caption (and "Learn more", always) | 13.5px | 500 (Learn more 600) | 0 | 1.4 | `--fg3`; Learn more is `--orange-text` |
| Mono | 13–15px | 500 | 0 | | `var(--mono)` |
| Token name in a list row (NVDAB) | 16px | 700 | 0 | | `--fg`, sans (not mono); the issuer after it is 12.5px / 300 / `--fg3` |

**Headline fade** (Revenue's `.gr`). Apply to one word or line of the hero, never to body text:
```css
.fade-text { background: linear-gradient(180deg,#ffffff 0%,rgba(255,255,255,.62) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.dim-text  { color: var(--fg3); }   /* Revenue's .nk, for a muted third line */
.hl        { color: var(--orange-text); }   /* an important word, in running text or a heading */
```
(`-webkit-background-clip: text` is the one prefixed property that is still written by hand; for `backdrop-filter` never write the `-webkit-` line, see 2.4.)

### 2.3 Radii
| Token | Value | Used for |
|---|---|---|
| `pill` | 999px | buttons, nav, nav links, chips, eyebrow, segmented tabs |
| `xl` | 28px | floating hero glass cards (`gcard`) |
| `lg` | 26px | footer card |
| `r` (default) | 22px | glass cards, trade card, sections |
| `md` | 18px | inner panels (You pay / You get), FAQ rows, chips, toasts |
| `sm` | 16px / 14px | list rows, inputs, token pills |
| `xs` | 12px / 4px | small badges, progress segments |
| round | 50% | avatars, issuer and token logos, icon buttons, spheres |

### 2.4 Surfaces
**Page background: one fixed image layer** (Round 6). A black base with an orange spotlight at the top and a few drifting specks, from `apps/web/public/bg-glow.webp` (about 7 KB; keep it compressed, WebP, black-based so it never bands). It is fixed to the viewport: **the background never scrolls; every section and card floats over it.** It is one element, rendered once in `app/layout.tsx`:
```css
.bg { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none;
  background: #000 url("/bg-glow.webp") center top / cover no-repeat; }
.bg .dots { display:none; }   /* the old dot grid, band and radial glows are gone */
```
Use a fixed element, not `background-attachment: fixed` (unreliable on iOS Safari). Page content sits above it at `z-10`. Nothing else may paint a full-page background.
Optional: BeUI `shader-background` at very low opacity, desktop only, paused under reduced motion (not currently used).

**Glass card: the default container** (Revenue `.glass`):
```css
.glass { position:relative; border-radius:var(--r); border:1px solid var(--edge);
  background: linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.028));
  backdrop-filter: blur(24px) saturate(150%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(0,0,0,.25),
              0 30px 70px -35px rgba(0,0,0,.9); }
```
**Hero glass: brighter, for floating showcase cards** (Revenue `.gcard`):
```css
.gcard { padding:20px; border-radius:28px; border:1px solid rgba(255,255,255,.22);
  background: linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.04) 55%,rgba(255,255,255,.08));
  backdrop-filter: blur(26px) saturate(160%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px 0 rgba(0,0,0,.2),
              0 40px 80px -30px rgba(0,0,0,.9); }
```
**Quiet panel: rows inside cards, FAQ, list items** (Revenue `details`):
```css
.panel { border-radius:18px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06);
  transition: background .2s; }
.panel:hover { border-color: rgba(255,255,255,.2); }
```
**Overlay backdrop** (modals, sheets): `background: rgba(5,6,7,.72); backdrop-filter: blur(8px);`

**Never write `-webkit-backdrop-filter` by hand.** The Tailwind/lightningcss build adds the prefix itself; when both lines were written it kept only the prefixed one, which Chrome ignores, and every blurred surface lost its blur in production. Write plain `backdrop-filter`.

**Everything glass stays glass.** The orange change does not touch glass or liquid-glass surfaces (`.glass`, `.gcard`, `.glass-solid`, glassy buttons, token pills, the Select panel, modals, the header bar): they keep the recipes in this section.

**Blur fallback.** Some devices can't render `backdrop-filter`, and stacking many blurred layers is slow on phones.
```css
@supports not (backdrop-filter: blur(1px)) {
  .glass, .gcard { background: rgba(35,37,42,.92); }
}
```
**Rule:** at most 3 blurred surfaces visible at once on mobile. Long lists inside a glass card use `.panel` rows, not nested glass.

**3D chrome shapes** (optional, landing only; the landing template in 5.1 uses a large glowing coin of our own artwork instead). Our own CSS or SVG spheres and a ring in the spirit of Revenue's: radial-gradient white spheres (`#fff → rgba(255,255,255,.72) → rgba(255,255,255,.3)`) with a soft drop shadow, plus a ring with a white conic or linear gradient. They float with the `float`/`drift` keyframes. They are decorative: `aria-hidden`, and on phones they shrink to 60% and stop drifting.

### 2.5 Buttons
All buttons: `height: 44px` (min touch target), `padding: 0 20px`, `border-radius: 999px`, `font-weight: 600`, `font-size: 15.5px`, `letter-spacing: -.1px`, `gap: 9px`.
`transition: transform .15s var(--ease), background .2s, box-shadow .2s, opacity .2s`. Pressed: `transform: scale(.98)`. Disabled: `opacity: .45; pointer-events: none`.

| Variant | Recipe | Use |
|---|---|---|
| **Primary (orange)** | `color:#fff; background:linear-gradient(180deg,var(--orange-hi) 0%,var(--orange) 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 -2px 0 rgba(0,0,0,.16), 0 12px 30px -12px var(--orange-glow)`. Hover: gradient `#ff8a52 → #f55a1f` and the glow grows to `0 16px 40px -10px`. | The one main action per screen: **Buy**, Sell, Continue, Sign in |
| **Glassy** | `background:rgba(255,255,255,.07); border:1px solid var(--edge); box-shadow: inset 0 1px 0 rgba(255,255,255,.12); backdrop-filter: blur(14px)`. Hover: `--hl` fill with a `--hl-edge` border (orange glass). | Secondary: Connect wallet, Top up, filters |
| **Light** | `background:#fff; color:#000; box-shadow: inset 0 1px 0 #fff, 0 10px 30px -12px rgba(255,255,255,.3)` | Not used in the app. Reserved for a white-on-dark marketing button on the landing page, if the landing design calls for one |
| **Ghost** | Transparent, `--fg2` text. Hover: `--fg` on `--hl` (orange glass). | Tertiary, nav-like |
| **Icon** | 36–40px circle, `rgba(255,255,255,.08)`, icon 16px | +/− (FAQ), the flip button, close |
| **Big trade button** (`.trade-cta`) | Primary recipe, full width, 18px / 750, radius 999px. The label always names the action and the token: "Buy $6.00 of NVDAon", "Sell NVDAB", or "Minimum sale is $5" (then it is disabled) | The trade card's CTA |

**Orange pills and chips** use the same fill (`--orange`, white 600 text, pill radius): the "Min $6" limit chip and the "Best" chip. Glass pills (token pills, eyebrow) stay glass.
**Selected toggle:** the selected option of a `Segmented` control is an orange pill with white text (`linear-gradient(180deg,var(--orange-hi),var(--orange))`). The *hover/selection highlight* in nav, menus and Select lists is the gliding orange-glass highlight pill (2.10), a softer orange than the solid selected toggle.

BeUI: use `button` (its `StatefulButton` variant) re-skinned with the recipes above. Use `action-swap` for label changes ("Buy" → "Confirm in wallet" → "Buying…" → "Done") and `expanding-arrow-button` for marketing CTAs.

### 2.6 Navigation
- **Desktop/tablet header:** sticky, `padding: 14px 16px 0`. Inner bar: `max-width: var(--w)`, `height: 62px`, radius 999px, `padding: 0 9px 0 12px`. **The bar is nearly clear** so text and page elements scrolling behind it stay visible: `.site-bar` is `background: rgba(255,255,255,.008)`, border `rgba(255,255,255,.1)`, `backdrop-filter: blur(3px)`; once scrolled `rgba(0,0,0,.03)` and `blur(4px)`. The blur must be hard to notice. Left: logo and wordmark. Middle: links. Right: primary (orange) or glassy actions (Get Started / wallet chip).
- **Nav links:** `padding: 8px 14px; border-radius: 999px; color: var(--fg2); font-weight: 500; font-size: 15.5px`. Hover and current page: text `--fg`. **Links have no background of their own**: the hover/current highlight is the single gliding pill (`components/motion/glide.tsx`, 2.10).
- **Nav items (owner, 2026-10-03):** Trade, Portfolio, Radar, How it works. The FAQ is a Home section and a footer link only.
- **Mobile (≤760px):** the links collapse. The header keeps logo, wallet chip and a menu button that opens a BeUI `bottom-sheet` with the links as large rows. Inside the app (after sign-in), a bottom tab bar (BeUI `expandable-tabs` or `dock`) with **Trade · Portfolio · Radar · More**.

### 2.7 Chips, badges, status
- **Eyebrow pill** (above the hero heading): 34px, glass, `padding: 0 15px 0 12px`, 13px/500 `--fg2` with a bold part in `--fg`. Example: "● Live on BNB Chain · **3 issuers compared**".
- **Status badges** (BeUI `animated-badge`): `TRADING` (up-green dot), `PRE-MARKET` / `AFTER HOURS` (blue), `EARNINGS: LIMITED` (amber), `PAUSED: <reason>` (red), `Not Tradable` (red, Radar). Use a 12px radius and 12px/600 text. Liquidity tags are named **Liquid** (grade A or B), **Low Liquidity** (C to F) and **Not Tradable** (ghost market); every tag has a tooltip (`components/ui/tooltip.tsx`).
- **Best chip:** white text on `--orange`.
- **Limit chip** (Revenue's "Up to $20,000"): white text on `--orange`, pill. Example: "Min $6".
- **Floating notice chip** (Revenue `.chip`): radius 18px, glass, 24px check circle, `float 7s` animation. Use it in the hero: "Shares delivered ✓ · tx link".
- **Integrity grade:** a circle 28–32px with the letter A–F. A/B white, C amber, D–F red. Tooltip lists the reasons.

### 2.8 Inputs and the trade card
- **Trade card:** a glass card with radius 22px containing two inner boxes (radius 18px): **You pay** and **You get**, with a **flip button** in the 8px gap between them. The flip button is a 40px round icon button with an up/down arrow (`ArrowUpDown`); it sits in its own zero-height row so it is centred on the gap in both modes, and the arrow turns 180° with a 300ms ease when the mode changes. Pressing it swaps **Buy** and **Sell** (Sell is behind `FEATURE_SELL`; while off the button is disabled and its label says why). In Sell mode the first box is "You sell" (shares of the token the wallet holds), the second "You get about" (USDT), and the slippage row and the "Min amount to receive" row are not shown (the sell sheet has its own).
  - **Amount input:** a big number (`clamp(37px,5vw,57px)`, 700). The `$` prefix is in `--fg3`.
  - **Asset pills:** on the right, a glass pill holding the token logo (two-letter monogram, ₮ for USDT) and the **token symbol** (NVDAon, NVDAB). Never a bare ticker (2.11). BeUI `combobox` / `morphing-search` for picking the stock; a `bottom-sheet` picker on mobile.
  - **Percent slider** (`components/ui/percent-slider.tsx`, native range, white fill on a faint-white track): "Use N% of your {USDT | NVDAB shares | token}", with the wallet's total ("12.50 USDT in your wallet", "0.0257 shares in your wallet") on the right. It sets the amount from the wallet balance (buy: USDT; sell: shares held; Send: USDT, BNB or a tokenized stock) and follows the typed amount back. At 100% a sell uses "Sell all" (the exact raw balance).
  - **Slippage:** a `Segmented` control (0.5 / 1 / 2%), then the action button, **then** the details rows.
  - **Details rows below:** price per share, premium vs US price, network fee (estimated), route, min amount to receive in shares. Label `--fg2` on the left, value `--fg` tabular on the right, hairline dividers `rgba(255,255,255,.06)`.
  - **Unit toggle:** `Segmented` to switch between **$** and **shares**.
  - **Minimum sale:** a sale worth less than $5 (`MIN_SELL_USDT`) is unclickable: the button reads "Minimum sale is $5" and is disabled; the Portfolio "Sell" button is disabled with a tooltip saying the holding is below the minimum; the sell sheet shows no Confirm.
- **Sell sheet** (modal): order top to bottom: shares input with "Sell all", percent slider, slippage, **Confirm sale (or Approve) right under the slippage control**, then the plan details (you send, expected, least you receive, route, fee), then the risk line and "Quotes refresh automatically every 15s". After a sale: status, block, network fee in dollars (gas units kept in `data-gas-used`), and, only once the worker has verified it from the chain, "USDT received" with "Guaranteed at least" directly under it in the same unit. Nothing is claimed before that.
- **Buy receipt** (modal): "Tokens received" with **"Guaranteed at least" directly under it**, both in the token's own unit (e.g. 0.041203 NVDAB), then the network fee.
- **Home trade card:** the stock picker, "You pay", "You get", then the **Buy {token symbol}** button, then **one line below the button**: issuer · price per share · fee (all on the same baseline, no "via", no percentage).
- **Text inputs** (wallet address, search): BeUI `input` restyled. Height 48px, radius 14px, `rgba(255,255,255,.04)` background, `--edge` border, focus ring `0 0 0 3px rgba(255,255,255,.08)` with border `--edge2`.

### 2.9 Data visualisation
- **Price charts:** single line, `--silver-1` (white) at 1.5px with an area fill gradient (`rgba(255,255,255,.18)` → transparent). The current price is a pulsing dot (`pulse` keyframe). Up and down moves are shown with `--up`/`--red` labels, not by recolouring the whole chart. Candles (Market API) are an optional toggle.
- **Issuer comparison bars:** horizontal bars of price-per-share premium centred on 0 (the US price). Bars glide when they re-sort.
- BeUI `number` for every live number: rolling digits on change, count-up on first view. BeUI `price-target-fan` and `returns-calendar` are optional extras for a ticker page.

### 2.10 Highlight pill (hover and selection lists)
One component owns every "this item is highlighted" pill: `components/motion/glide.tsx` (`<Glide>`; items carry `data-glide`). Used by the nav links, the mobile menu, Select option lists and `Segmented`.
- **One pill per list**, not a background per item. It is measured from the item's layout offsets (`offsetLeft/Top/Width/Height`, not bounding boxes, so items that are still sliding in or sit in a scaling modal never mis-place it) and moves with a CSS transition (`transform`, `width`, `height`: 340ms, `cubic-bezier(.22,1.25,.36,1)`). A CSS transition retargets from the pill's current position on each new hover and runs off the main thread, so a busy page (live numbers, polling) cannot make it snap. A JS spring was tried and snapped; do not go back to it.
- **Rests on the selected item** (`aria-current="page"`, `aria-selected="true"` or `aria-checked="true"`), follows the pointer or focus, fades out otherwise. The first time it appears it jumps into place (no flight from the corner). Reduced motion: no transition.
- **Colour:** orange glass (`.glide-pill`: `--hl` fill, `--hl-edge` hairline; `--hl-strong` while an item is pressed). It is the highlight for hover, the selected item and the pressed item in nav, menus and Select lists. Never grey, never plain faint white.
- **Never** give a nav link or option its own hover background: it fights the pill.

### 2.11 Naming and copy rules
- **No bare tickers.** Wherever a token is named, use the issuer's own symbol: Ondo `NVDAon`, bStock `NVDAB`, xStocks `NVDAx` (`tokenSymbol(ticker, issuer)` in `lib/tickers.ts`). Where a stock is named before an issuer is chosen, show both tokens (`tokenPair(ticker)` → "NVDAon / NVDAB") or the company name ("NVIDIA"). A bare "NVDA" would suggest the user is buying the underlying stock.
- Always say **tokenized shares**; never imply the underlying shares. UI copy says "the guarantee", not "ShareGuard". No contract address is linked outside `/docs` (transaction links on receipts are fine).
- **Units:** shares are the main unit; where a number is compared with a floor ("Tokens received" and "Guaranteed at least") both are in the same unit, one directly under the other.
- **Money fields:** dollars for fees ("Network fee ≈ $0.023"; gas units may sit beside it for agents, e.g. `data-gas-used`).
- **Minimums:** buy from $6, sell from $5. A refused sale reads "The sale is below the $5 minimum order. Transaction will fail."
- **"Learn more"** (never "Read more") is always caption size and orange; the modal it opens ends in a "Tell me more" button.
- **Orange words:** wrap a genuinely important word or phrase in `.hl`; one or two per screen at most.

---

## 3. Motion

### 3.1 Motion tokens
| Token | Value | Source |
|---|---|---|
| `--ease` (CSS default) | `cubic-bezier(.2,.8,.2,1)` | Revenue |
| `EASE_OUT` | `cubic-bezier(.16,1,.3,1)` | BeUI `lib/ease.ts` |
| `EASE_IN_OUT` | `cubic-bezier(.77,0,.175,1)` | BeUI |
| `EASE_DRAWER` | `cubic-bezier(.32,.72,0,1)` | BeUI |
| `SPRING_PRESS` | stiffness 500, damping 30, mass .6 | BeUI: button press |
| `SPRING_SWAP` | 460 / 30 / .55 | BeUI: label and icon swaps |
| `SPRING_PANEL` | 420 / 40 / .5 | BeUI: modals, sheets |
| `SPRING_LAYOUT` | 360 / 32 / .6 | BeUI: gliding pills, re-sorting lists |
| `SPRING_MOUSE` | 200 / 15 / .3 | BeUI: tilt, magnetic |

Keep BeUI's `lib/ease.ts` as the one motion file. Add Revenue's `--ease` there as `EASE_REVENUE`.

| Duration | Use |
|---|---|
| 120–150ms | hover colour and background, press |
| 200–300ms | small UI transitions (tabs, chips, tooltips) |
| 350–500ms | panels, cards entering, route changes |
| 700ms | scroll reveal (Revenue `.reveal`) |
| 7s+ loops | ambient float/drift only |

### 3.2 Patterns
| Pattern | Spec | Where |
|---|---|---|
| **Scroll reveal** (Revenue) | from `opacity:0; translateY(18px)` to visible over `.7s var(--ease)`, triggered once at about 15% visibility; children stagger 60ms | every landing section, cards |
| **Blur-in** (Linear) | from `opacity:0; filter:blur(8px); translateY(8px)` to visible over 400–500ms `EASE_OUT` | hero heading words, section titles (BeUI `text-animation` spring reveal) |
| **Staggered list** (Linear) | rows enter 40ms apart with `fade` (`opacity 0, y 8px → none`) | issuer quote list, portfolio rows, FAQ |
| **Glow on hover** (Linear) | radial highlight that follows the cursor inside the card border (`radial-gradient(240px at var(--x) var(--y), rgba(255,255,255,.08), transparent)`), only on hover-capable devices | glass cards, issuer cards |
| **Tilt** | BeUI `tilt-card`, `max` 8–12°, glare on, only where `(hover:hover) and (pointer:fine)` | hero showcase cards, Radar cards |
| **Float / drift** (Revenue) | `float`: translateY −14px at 50%, 7s ease-in-out infinite. `drift`: translate(−30px, 24px) at 50%. | hero chips, spheres |
| **Number roll** (Mercury-style) | BeUI `number`: rolling digits when a price changes; count-up once when a number first appears | prices, shares, balances, stats |
| **Gentle parallax** (Mercury) | hero shapes move ≤ 12px on scroll; no other parallax | hero only |
| **Hover lift** (Mercury) | `translateY(-2px)` plus a slightly stronger shadow, 200ms | clickable cards |
| **Highlight glide** | one pill per list, measured from layout offsets and moved with a CSS transition (`transform`, `width`, `height`, 340ms, slight overshoot), retargeted from its current position on every new hover; rests on the selected item; fades out otherwise | nav, mobile menu, Select options, Segmented (2.10) |
| **Re-sort glide** | `layout` animation with `SPRING_LAYOUT` when the best issuer changes | quote list |
| **Shimmer loading** (Revenue `shim`) | moving gradient over skeletons while quotes load | quote cards, portfolio |
| **Trade progress** | BeUI `dynamic-island` pill morphs through *Quoting → Approve → Swap → Confirmed*, with a 4-segment progress bar like Revenue's order card | trade flow, top of screen |
| **Toasts** | BeUI `animated-toast-stack`, swipe to dismiss | trade results, errors |
| **Modal / sheet** | BeUI `morphing-modal` on desktop, `bottom-sheet` on mobile, `SPRING_PANEL` | sign-in, top-up, confirmations |
| **Page transitions** | 250ms cross-fade + 8px slide via `AnimatePresence` (or the View Transitions API where supported) | route changes |
| **Marquee** | BeUI `marquee`, pauses on hover: a strip of supported tickers with live share prices | landing |

### 3.3 Rules
1. **Animate only `transform`, `opacity` and `filter`.** Never animate width, height or top/left on live data. Use `layout` animations for re-sorting. Two deliberate exceptions, both on tiny absolutely-positioned or clipped elements: the highlight pill's `width`/`height` (2.10) and a Select panel's height.
2. **Never move a price while the user is about to confirm.** On the confirm step, numbers update with a quick cross-fade, and changes beyond the guard show "price changed: review".
3. **`prefers-reduced-motion: reduce`:**
   - Turn off: float, drift, tilt, parallax, marquee, shader backgrounds.
   - Scroll reveal becomes a 150ms opacity fade.
   - Number rolls change instantly.
   - BeUI components already respect `useReducedMotion`; keep it that way.
4. **Hover-only effects** (tilt, glow, magnetic) are gated by BeUI's `useHoverCapable()`, so touch devices never get "stuck hover".
5. **Performance budget:**
   - 60fps on a mid-range Android phone.
   - Ambient animations pause when off-screen (IntersectionObserver).
   - No more than 2 infinite animations visible at once on mobile.

---

## 4. Layout and responsiveness

**Breakpoints** (from Revenue's stylesheet, plus a wide one):

| Name | Width | Layout |
|---|---|---|
| `xs` | ≤ 440px | single column, 16px side padding, big numbers at the `clamp` minimum, hero shapes at 60% and static |
| `sm` | ≤ 560px | single column, 20px padding |
| `md` | ≤ 760px | single column; nav collapses to menu + bottom sheet; app bottom tab bar |
| `lg` | ≤ 980px | two columns where useful (copy + card); FAQ stacks |
| `xl` | > 980px | full layout; content `max-width: 1180px`; FAQ `grid-template-columns: .8fr 1.2fr; gap: 40px` |

**Rules**
- **Test widths for every screen before it counts as done:** 375, 390, 768, 1024, 1280, 1440px. Playwright screenshots at 375, 768 and 1280 run in CI.
- **Touch targets** are at least 44×44px. No hover-only information: tooltips also open on tap.
- **No horizontal scroll** at any width. Long hashes and addresses truncate in the middle (`0x2Bf7…2930`) with a copy button.
- **Safe areas:** respect `env(safe-area-inset-*)` for the iOS home bar and the Telegram Mini App.
- **Spacing:** section vertical padding `clamp(64px, 10vw, 120px)`; card padding 20–24px (16px on `xs`); gaps between cards 12–16px.

---

## 5. Page blueprints
Each page lists its sections in order, and the BeUI components to use.

### 5.1 Landing (built last)
**The landing page is built from the owner's Dribbble reference** (`docs/design/landing-reference.webp`), on the Round 6 look: black page with the fixed orange spotlight, an orange pill nav action, dark glass cards, orange pills and buttons, white and faint-white (`--fg2`) text. Its sections, in order: header with a small announcement pill above the hero; a two-line hero heading with a muted second line; a short `--fg2` sentence; one orange CTA; a row of floating dark-glass product cards (markets list, price chart card, top-gainer cards); a "trusted by" logo strip; a "How it works" pill and heading with a four-tab switcher (`Segmented`-style) over a product screenshot; a three-up feature card grid (fast, low fees, secure); a large glowing coin with a ring of small token icons ("the whole universe"); an encryption/wallet block with a dashboard card. We borrow the layout and mood, **not** its copy, logos, names, coin artwork or images: everything is our own, and the product claims follow the rules in 2.11 (tokenized shares, never the underlying). The older Revenue-based blueprint below is kept as the content outline; where its visuals conflict with this paragraph (white or silver CTAs, chrome spheres, diagonal band background), this paragraph wins.

1. **Header:** floating glass pill nav (see 2.6).
2. **Hero** (two columns ≥980px, stacked below):
   - Eyebrow pill: "● Live on BNB Chain · **Ondo · bStocks · xStocks**".
   - h1 with blur-in: "Buy **tokenized shares**," / a second faded line: "at the best prices." (the tagline never says "buy shares" without "tokenized": these are not the underlying shares).
   - Lead paragraph (`--fg2`): one sentence on comparing issuers and the on-chain share guarantee.
   - Primary orange CTA "Get a quote" plus glassy "See the trap" (goes to Radar).
   - Right side: 2–3 **floating hero glass cards** (`gcard` + `tilt-card`) showing a real quote ("NVDAon · 0.0261 shares · −0.12% vs US price"), a receipt ("Shares delivered ✓"), and an integrity card ("NFLXon token = **10** shares"). (Chrome spheres and a ring are optional; see 2.4.)
3. **Ticker marquee:** live share prices across issuers.
4. **"One stock, three tokens":** the unit trap explained with an interactive card that flips between "token price" and "price per share" (NFLXon / NFLXB example, real numbers from the engine).
5. **Live comparison preview:** the actual trade card (read-only until signed in), plus a notification stack (BeUI `notification-stack`) of recent real fills ("0.0261 NVDA shares · −0.12% · 2m ago").
6. **ShareGuard section:** "Guaranteed in shares, on-chain". A 3-step diagram (quote → guard → shares) with the BscScan link of a real guarded trade.
7. **Radar teaser:** "We've caught these so you don't buy them": ghost-market xStocks cards with red "Not Tradable" badges.
8. **FAQ** (BeUI `bouncy-accordion`, Revenue layout: title left, accordion right).
9. **Footer:** a rounded glass card (radius 26px) with columns Product / Learn / Community / Legal, and the disclaimer line ("Not investment advice. Not available in restricted regions.").

### 5.2 Trade (`/trade/[ticker]`), the core screen
- **Desktop (≥980px): the trade card is on the LEFT** and the stock header (picker, name, live price, chart) and issuer comparison are on the right; both columns scroll together (nothing is sticky). **On a phone** the order is price, then the trade card, then the issuer comparison.
- **The trade card** (2.8) has the $ / shares toggle, the flip button, the percent slider and the details.
- **Under the card:** the **issuer comparison list**. One row per issuer with:
  - shares you get;
  - price per share;
  - premium vs US price;
  - network fee;
  - hops;
  - integrity grade.

  The best row has a white border glow and a "Best" chip. Rows re-sort with a glide. A "why?" disclosure explains the route in words ("USDT → BTC → USDC → NVDAB → NVDAon").
- **Trade flow:** `dynamic-island` progress, confirm sheet with re-quote, and a receipt card in shares with the BscScan link.

### 5.3 Portfolio (`/portfolio`)
- **Wallet card** (BeUI `wallet-card`, restyled): total value; holdings in **shares** per stock, grouped across issuers ("1.73 shares = 1.20 NVDAon + 0.53 NVDAB"); "dividends received as shares" from multiplier growth. The full wallet address is shown, without a copy button.
- **Holdings list:** `.panel` rows. Each token row starts with the **token name** (NVDAB: 16px bold) followed by the issuer (bStock: 12.5px light, `--fg3`), then tokens × multiplier = shares, then the Sell button (disabled with a tooltip under the minimum sale).
- **Top up / Connect wallet** actions (glassy) when the balance is low.

### 5.4 Radar (`/radar`, formerly "Trap Shield")
- **Cards per trap type:**
  - unit mismatch (NFLX 10×);
  - ghost market (xStocks volume ≈ $0);
  - API vs on-chain multiplier disagreement;
  - paused / corporate action.
- **A searchable list** (beUI Morphing Search, suggestions, surface capped at 380px, no page blur) of every token's integrity grade and reasons, ordered Liquid, then Low Liquidity, then Not Tradable.

### 5.5 Telegram Mini App (later)
The same tokens and components inside Telegram's webview. It uses Telegram theme parameters only for the safe area and the header colour. Our black, white and orange palette stays.

---

## 6. BeUI component map
Install with the shadcn CLI. The commands are in the BeUI MCP (`get_install_command`), e.g. `pnpm dlx shadcn add @beui/tilt-card`. After installing, restyle each component with the tokens above; never leave default shadcn colours.

| Need | BeUI component |
|---|---|
| Hero showcase cards | `tilt-card` |
| Buttons (primary orange, stateful) | `button` (StatefulButton), `action-swap`, `expanding-arrow-button` |
| Nav / menu / Select highlight pill | `components/motion/glide.tsx` (`<Glide>` + `data-glide`; our own, modelled on beUI's File Tree and `shared-layout-bg`) |
| Mobile menu / pickers / confirm | `bottom-sheet` |
| Desktop modals (sign-in, top-up, confirm) | `morphing-modal`, `center-morph-modal` |
| Stock / ticker search | `morphing-search`, `command-palette` (⌘K), `combobox`; the stock dropdown is beUI `select` (glass classes) |
| $ / shares toggle, slippage, section tabs | `components/motion/segmented.tsx` (beUI `tabs` pill variant on `Glide`), `expandable-tabs` (mobile bottom bar) |
| Percent of balance | `components/ui/percent-slider.tsx` (native range, ours) |
| Live numbers | `components/motion/animated-number.tsx` (Spectrum UI Number Ticker, Apache-2.0) via `live.tsx` |
| Headline reveal, shimmer | `text-animation`, `loading-states` |
| Status badges | `animated-badge` |
| Trade progress | `dynamic-island` |
| Toasts | `animated-toast-stack` |
| Recent fills | `notification-stack` |
| FAQ | `bouncy-accordion` |
| Ticker strip | `marquee` |
| Portfolio card | `wallet-card` |
| Radar list | `table` or the Radar row cards |
| Loaders | `loader` |
| Ambient background (optional, desktop) | `shader-background` |
| Smooth scroll (optional) | `scroll-animation` (Lenis) |
| Reference only, for flip-arrow and quote morph ideas | `swap` |

---

## 7. Accessibility checklist (part of "done" for every screen)
- Text contrast meets the measured ratios in 2.1. Never put `--fg-disabled` on information.
- A visible focus ring on every interactive element (`0 0 0 3px rgba(255,255,255,.18)`).
- Full keyboard path through the trade flow. Esc closes sheets and modals. Focus is trapped in dialogs and returns afterwards.
- Live price changes are announced politely (`aria-live="polite"`) at most once every 10s, and never during confirm.
- Icons have labels. Decorative shapes are `aria-hidden`.
- Reduced motion is honoured (3.3).
