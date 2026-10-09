# Token Icon Sources

This directory contains brand icon assets for tokenized stocks displayed in Tally.

## Token Icons

| Ticker | Company Name | File Name | Dimensions | Size | Source | Date Added |
|---|---|---|---|---|---|---|
| AAPL | Apple Inc. | AAPL.webp | 128x128 px | 578 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| AMZN | Amazon.Com Inc | AMZN.png | 128x128 px | 3675 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| BABA | Alibaba Group Holding Limited | BABA.png | 128x128 px | 6741 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| BMNR | Bitmine Immersion Technologies, Inc. | BMNR.png | 128x128 px | 9525 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| CRCL | Circle Internet Group, Inc. | CRCL.png | 128x128 px | 9758 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| GME | GameStop Corp. | GME.png | 128x128 px | 4280 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| GOOGL | Alphabet Inc. | GOOGL.png | 128x128 px | 1614 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| HOOD | Robinhood Markets, Inc. | HOOD.png | 128x128 px | 592 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| INTC | Intel Corp | INTC.png | 128x128 px | 3305 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| META | Meta Platforms, Inc. | META.png | 128x128 px | 2421 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| MSFT | Microsoft Corp | MSFT.png | 128x128 px | 1842 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| MSTR | Strategy Inc | MSTR.png | 128x128 px | 8596 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| NFLX | NetFlix Inc | NFLX.png | 128x128 px | 4937 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| NVDA | Nvidia Corp | NVDA.png | 128x128 px | 8238 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| SKHY | SK Hynix | SKHY.png | 128x128 px | 7891 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| SNDK | SanDisk | SNDK.png | 128x128 px | 4124 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| SPCX | SpaceX | SPCX.png | 128x128 px | 3863 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| SPY | SPDR S&P 500 ETF Trust | SPY.png | 128x128 px | 8635 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| TSLA | Tesla, Inc. | TSLA.png | 128x128 px | 1614 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |
| TSM | Taiwan Semiconductor Manufacturing Co Ltd. | TSM.png | 128x128 px | 10158 B | PancakeSwap, downloaded by the chief engineer | 2026-10-09 |

## Tickers Without an Icon File (Letter Fallback)

Tokens without a dedicated image asset render using the standard two-letter abbreviation badge (`TokenLogo` component).

### Buyable Tickers in ShareGuard (`apps/web/lib/buyable.generated.ts`)
Among the 21 buyable tickers in Tally, 20 have dedicated icon assets above. The following buyable ticker currently has no icon file:
- **QQQ**: Invesco QQQ Trust

### Full 21-Ticker Buyable Set Status
For reference, the 21 buyable tickers defined in `apps/web/lib/buyable.generated.ts` and their icon status:
1. **AAPL**: Apple Inc. (Icon present: `AAPL.webp`)
2. **AMZN**: Amazon.Com Inc (Icon present: `AMZN.png`)
3. **BABA**: Alibaba Group Holding Limited (Icon present: `BABA.png`)
4. **BMNR**: Bitmine Immersion Technologies, Inc. (Icon present: `BMNR.png`)
5. **CRCL**: Circle Internet Group, Inc. (Icon present: `CRCL.png`)
6. **GME**: GameStop Corp. (Icon present: `GME.png`)
7. **GOOGL**: Alphabet Inc. (Icon present: `GOOGL.png`)
8. **HOOD**: Robinhood Markets, Inc. (Icon present: `HOOD.png`)
9. **INTC**: Intel Corp (Icon present: `INTC.png`)
10. **META**: Meta Platforms, Inc. (Icon present: `META.png`)
11. **MSFT**: Microsoft Corp (Icon present: `MSFT.png`)
12. **MSTR**: Strategy Inc (Icon present: `MSTR.png`)
13. **NFLX**: NetFlix Inc (Icon present: `NFLX.png`)
14. **NVDA**: Nvidia Corp (Icon present: `NVDA.png`)
15. **QQQ**: Invesco QQQ Trust (No file — uses letter fallback)
16. **SKHY**: SK Hynix (Icon present: `SKHY.png`)
17. **SNDK**: SanDisk (Icon present: `SNDK.png`)
18. **SPCX**: SpaceX (Icon present: `SPCX.png`)
19. **SPY**: SPDR S&P 500 ETF Trust (Icon present: `SPY.png`)
20. **TSLA**: Tesla, Inc. (Icon present: `TSLA.png`)
21. **TSM**: Taiwan Semiconductor Manufacturing Co Ltd. (Icon present: `TSM.png`)

### Other Known Tokenized Stocks Using Letter Fallback
Additional tokenized stock candidates and tracked registry tickers that do not have dedicated image files and use the letter fallback:
- **DJT**: Trump Media & Technology Group Corp.
- **FLNC**: Fluence Energy, Inc.
- **MRNA**: Moderna, Inc.
- **SOXL**: Direxion Daily Semiconductor Bull 3X Shares
- **SOXS**: Direxion Daily Semiconductor Bear 3X Shares
- **SQQQ**: ProShares UltraPro Short QQQ
- **TQQQ**: ProShares UltraPro QQQ

---

> These logos identify the company or fund and belong to their owners. Tally uses them only to label tokenized stocks, and is not affiliated with any of them.
