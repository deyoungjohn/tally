/**
 * Region block page (blueprint §9). Plain HTML with a real HTTP 451, no JavaScript and no other
 * asset, styled with the DESIGN.md tokens (inlined). The gate returns it directly instead of
 * rewriting to a route: behind a tunnel the request URL is `https://localhost:3000`, and a
 * rewrite makes Next proxy it over TLS to a plain-HTTP port (EPROTO).
 */
export const BLOCKED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1a1b1f">
<title>Not available in your region | Tally</title>
<style>
:root{color-scheme:dark;--g0:#0c0d0f;--g1:#131417;--g2:#1a1b1f;--fg:#eef0f2;--fg2:#a3a8b0;--fg3:#8b9098;--edge:rgba(255,255,255,.12)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:linear-gradient(180deg,var(--g2) 0%,var(--g1) 40%,var(--g0) 100%);color:var(--fg);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:480px;width:100%;padding:32px;text-align:center;border-radius:22px;border:1px solid var(--edge);background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.028));box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 30px 70px -35px rgba(0,0,0,.9)}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.03em}
.logo i{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#fff 0%,#c9ced5 38%,#5d636c 100%)}
h1{margin:24px 0 0;font-size:clamp(28px,6vw,36px);font-weight:750;letter-spacing:-.035em;line-height:1.1}
p{margin:12px 0 0;color:var(--fg2);font-size:18px;line-height:1.6}
small{display:block;margin-top:20px;color:var(--fg3);font-size:12.5px}
</style>
</head>
<body>
<main>
<span class="logo"><i aria-hidden="true"></i>Tally</span>
<h1>Not available in your region</h1>
<p>Tally can’t be used from your location. This applies to the whole site, including quotes and prices.</p>
<small>If you think this is a mistake, make sure you are not on a VPN or Tor, then reload.</small>
</main>
</body>
</html>`;

export function blockedResponse(): Response {
  return new Response(BLOCKED_HTML, {
    status: 451,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
