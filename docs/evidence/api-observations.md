# API Observations: Raw Evidence for Developer Experience Report

This document records the exact requests (path and parameters, no keys) and exact response snippets from the recorded module probe fixtures (`spike/results/module_probes_*.json`).
It covers all 12 items identified in `MODULES.md` §6 as raw factual evidence for the developer experience report.
All response snippets match the raw fixture files byte-for-byte.

---

## 1. `rwa/tokens?tabId=…` ignores `tabId`

- **Reference**: `MODULES.md` §6, Item 1: *`rwa/tokens?tabId=…` ignores `tabId`: tabs 3, 4, 9, 11, 13 return the same 488 tokens (`P_tab_*`, `G_rwa_tokens_earnings`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Keys**: `P_tab_mag7` (tabId=9), `P_tab_buffett` (tabId=13), `P_tab_etf` (tabId=11), `P_tab_ai_chips` (tabId=4), `G_rwa_tokens_earnings` (tabId=3)

### Exact Request (`P_tab_mag7`)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/rwa/tokens`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tabId`: `9`

### Exact Response Snippet
Each request with `tabId` (e.g. `9` for Mag 7, `13` for Buffett, `11` for ETF, `4` for AI Chips, `3` for Upcoming Earnings) returns the identical set of 488 tokens (`len(data) == 488`). The first item returned is SpaceX (`SPCXon`) rather than a Magnificent 7 stock:
```json
   {
    "binanceChainId": "56",
    "tokenContractAddress": "0xd0a58bc9d88d3ff48c0294cb7e45937d0e41a928",
    "platformId": "ondo",
    "assetType": 1,
    "tokenName": "SpaceX (Ondo Tokenized)",
    "tokenSymbol": "SPCXon",
    "tokenLogoUrl": "https://onchainos.bnbstatic.com/images/web3-data/public/token/logos/36af4569629f4b97bd6ff7a3d0a5a664.png",
    "decimals": "18",
    "underlyingTicker": "SPCX",
    "underlyingName": "SpaceX",
    "underlyingNameZh": "SpaceX",
    "tokenToShareRatio": "1",
    "tags": null,
    "statusInfo": {
     "openState": true,
     "marketStatus": "offhours",
     "reasonCode": "TRADING",
     "reasonMsg": null,
     "nextOpenTime": 1791158700000,
     "nextCloseTime": 1791158100000
    },
    "tokenPrice": "159.175",
    "referencePrice": "159.175",
    "volume24H": "19078577685.167114",
    "marketCap": "2095375740057",
    "peRatioTTM": null
   }
```

---

## 2. `POST /market/price` and `/market/price-info` return `50000 Internal server error`

- **Reference**: `MODULES.md` §6, Item 2: *`POST /market/price` and `/market/price-info` return `50000 Internal server error` for every stock token tried (`F_price_*`, `F_price_info_*`), while `rwa/price` works.*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Keys**: `F_price_NVDAB`, `F_price_info_NVDAB`, `P_rwa_price_batch`

### Exact Request 1 (`F_price_NVDAB`)
- **HTTP Method**: `POST`
- **Path**: `/api/v1/dex/market/price`
- **Request Body Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`

### Exact Response Snippet 1 (`F_price_NVDAB`)
```json
  "body": {
   "code": 50000,
   "msg": "Internal server error, please retry later",
   "data": null,
   "timestamp": 1791032394987,
   "success": false
  }
```

### Exact Request 2 (`F_price_info_NVDAB`)
- **HTTP Method**: `POST`
- **Path**: `/api/v1/dex/market/price-info`
- **Request Body Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`

### Exact Response Snippet 2 (`F_price_info_NVDAB`)
```json
  "body": {
   "code": 50000,
   "msg": "Internal server error, please retry later",
   "data": null,
   "timestamp": 1791032391437,
   "success": false
  }
```

### Exact Request 3 (`P_rwa_price_batch` - Working Alternative)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/rwa/price`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddresses`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436,0xa9ee28c80f960b889dfbd1902055218cba016f75,0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a,0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4`

### Exact Response Snippet 3 (`P_rwa_price_batch`)
```json
  "data": [
   {
    "binanceChainId": "56",
    "tokenContractAddress": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "platformId": "bstock",
    "tokenPrice": "234.26000000",
    "referencePrice": "234.077835",
    "tokenPriceUpdatedAt": 1791032443632
   },
   {
    "binanceChainId": "56",
    "tokenContractAddress": "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    "platformId": "ondo",
    "tokenPrice": "234.837114351487868763",
    "referencePrice": "234.435",
    "tokenPriceUpdatedAt": 1791032454469
   },
   {
    "binanceChainId": "56",
    "tokenContractAddress": "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
    "platformId": "bstock",
    "tokenPrice": "333.20000000",
    "referencePrice": "332.9989",
    "tokenPriceUpdatedAt": 1791032456696
   },
   {
    "binanceChainId": "56",
    "tokenContractAddress": "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
    "platformId": "ondo",
    "tokenPrice": "334.520566104620999632",
    "referencePrice": "333.395",
    "tokenPriceUpdatedAt": 1791032454440
   }
  ]
```

---

## 3. Undocumented `marketStatus: "offhours"` (Ondo, Saturday)

- **Reference**: `MODULES.md` §6, Item 3: *`marketStatus: "offhours"` (Ondo, Saturday) is not in the documented enum (`G_underlying_market_NVDAon`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `G_underlying_market_NVDAon`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/rwa/underlying-market`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0xa9ee28c80f960b889dfbd1902055218cba016f75`

### Exact Response Snippet
```json
   "statusInfo": {
    "openState": true,
    "marketStatus": "offhours",
    "reasonCode": "TRADING",
    "reasonMsg": null,
    "nextOpenTime": 1791158700000,
    "nextCloseTime": 1791158100000
   }
```

---

## 4. bStock `statusInfo.marketStatus` is always `null`

- **Reference**: `MODULES.md` §6, Item 4: *bStock `statusInfo.marketStatus` is always `null`, `nextOpenTime` null (`G_underlying_market_NVDAB`, 92/92 in the 10-02 list).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `G_underlying_market_NVDAB`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/rwa/underlying-market`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`

### Exact Response Snippet
```json
   "statusInfo": {
    "openState": true,
    "marketStatus": null,
    "reasonCode": "TRADING",
    "reasonMsg": null,
    "nextOpenTime": null,
    "nextCloseTime": null
   }
```

---

## 5. bStock `protections.collateralReport.supported: true` with `url: null`

- **Reference**: `MODULES.md` §6, Item 5: *bStock `protections.collateralReport.supported: true` with `url: null` (`G_underlying_profile_NVDAB`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `G_underlying_profile_NVDAB`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/rwa/underlying-profile`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`

### Exact Response Snippet
```json
   "protections": {
    "collateralReport": {
     "supported": true,
     "description": null,
     "url": null
    }
   }
```

---

## 6. `trades[].price` is meaningless when counterpart is not a dollar stablecoin

- **Reference**: `MODULES.md` §6, Item 6: *`trades[].price` is meaningless when the counterpart isn't a dollar stablecoin (NVDAB vs JARVIS: `4778237`) (`F_trades_NVDAB`).*
- **Source File**: `spike/results/module_probes_20261003T121018Z.json`
- **Probe Key**: `F_trades_NVDAB`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/trades`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`
  - `limit`: `100`

### Exact Response Snippet
The first trade in the array is an exchange of NVDAB against JARVIS (`0x4e3d92fb06c5bac60b7358580ed32b2f9ddd7777`), where the returned `price` field reflects raw token ratio `4778237.05528148439848252` instead of USD price:
```json
    {
     "binanceChainId": "56",
     "tokenContractAddress": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
     "txHash": "0xb74066ece67d43398906bae5ebff934ae7ac4d2e0fdfc66f6ad15b9ea075b2e2",
     "userAddress": "0xd0d29ad6b3d6ff3749fd791580a2b66c8997049f",
     "dexName": "PancakeSwap v2 (BSC)",
     "type": "buy",
     "price": "4778237.05528148439848252",
     "volume": "2.419059191358230757",
     "time": 1791029339000,
     "changedTokenInfo": [
      {
       "amount": "0.010321562553099999",
       "tokenSymbol": "NVDAB",
       "tokenContractAddress": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"
      },
      {
       "amount": "49318.872659628179168922",
       "tokenSymbol": "JARVIS",
       "tokenContractAddress": "0x4e3d92fb06c5bac60b7358580ed32b2f9ddd7777"
      }
     ]
    }
```

---

## 7. `top-trader` AAPLB entry with `avgSellPrice 20742` for a ~$335 stock

- **Reference**: `MODULES.md` §6, Item 7: *`top-trader` AAPLB entry with `avgSellPrice 20742` for a ~$335 stock (`F_top_trader_AAPLB`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `F_top_trader_AAPLB`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/token/top-trader`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `tokenContractAddress`: `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a`

### Exact Response Snippet
The top trader in the list displays an `avgSellPrice` of `20742.578121580851563977`:
```json
   {
    "holderWalletAddress": "0x1db96a54be55082ba95c01c55944c72bab376ef0",
    "holdAmount": "0",
    "holdingPercent": "0",
    "boughtAmount": "0.3878978171358959",
    "avgBuyPrice": "308.63859540676180269",
    "soldAmount": "5.488996046251352",
    "avgSellPrice": "20742.578121580851563977",
    "maxHoldAmount": null,
    "lastTradeTime": 1790121763000,
    "realizedPnlUsd": "111712.01052787964",
    "fundingSource": "0x8888003dac9ab78269d084b205bf9ab54dd9fcf5",
    "fundingSourceLabel": null,
    "fundingSourceHash": "0xfae03ba2f32d9a9c2f051c174986fc471b0ed75249dd8a3d97406e6737903afe",
    "fundingSourceTime": 1752850140,
    "fundingSourceAmount": "0.04"
   }
```

---

## 8. `portfolio/overview` reveals required parameters one at a time

- **Reference**: `MODULES.md` §6, Item 8: *`portfolio/overview` error says "timeFrame is required" when `walletAddress` was sent, then "walletAddress is required" when `address` was sent: the two errors arrive one at a time (`X_portfolio_overview*`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Keys**: `X_portfolio_overview`, `X_portfolio_overview_b`

### Exact Request 1 (`walletAddress` provided, missing `timeFrame`)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/portfolio/overview`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `walletAddress`: `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`

### Exact Response Snippet 1
```json
  "body": {
   "code": 40001,
   "msg": "Parameter timeFrame is required",
   "data": null,
   "timestamp": 1791032460693,
   "success": false
  }
```

### Exact Request 2 (`address` provided instead of `walletAddress`)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/portfolio/overview`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `address`: `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`

### Exact Response Snippet 2
```json
  "body": {
   "code": 40001,
   "msg": "Parameter walletAddress is required",
   "data": null,
   "timestamp": 1791032461592,
   "success": false
  }
```

---

## 9. Generic `Parameter error` in DeFi endpoints

- **Reference**: `MODULES.md` §6, Item 9: *`defi/data/investment/list` answers a generic `Parameter error` when `investType` is missing instead of naming it (`R_investment_list*`); `position/list` the same for `addresses`.*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Keys**: `R_investment_list`, `R_position_list`

### Exact Request 1 (`R_investment_list` missing `investType`)
- **HTTP Method**: `POST`
- **Path**: `/api/v1/defi/data/investment/list`
- **Request Body Parameters**:
  - `binanceChainId`: `56`

### Exact Response Snippet 1
```json
  "body": {
   "code": 40001,
   "msg": "Parameter error",
   "data": null,
   "timestamp": 1791032467244,
   "success": false
  }
```

### Exact Request 2 (`R_position_list` missing `addresses` array)
- **HTTP Method**: `POST`
- **Path**: `/api/v1/defi/data/position/list`
- **Request Body Parameters**:
  - `binanceChainId`: `56`
  - `walletAddress`: `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`

### Exact Response Snippet 2
```json
  "body": {
   "code": 40001,
   "msg": "Parameter error",
   "data": null,
   "timestamp": 1791032481853,
   "success": false
  }
```

---

## 10. `transactions-by-address` fails with generic `Parameter error`

- **Reference**: `MODULES.md` §6, Item 10: *`transactions-by-address` returns `Parameter error` for every combination tried (`X_tx_by_address`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `X_tx_by_address`

### Exact Request
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/post-transaction/transactions-by-address`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `address`: `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`
  - `limit`: `20`

### Exact Response Snippet
```json
  "body": {
   "code": 40001,
   "msg": "Parameter error",
   "data": null,
   "timestamp": 1791032465397,
   "success": false
  }
```

---

## 11. Leaderboard and address tracker parameter sequential errors

- **Reference**: `MODULES.md` §6, Item 11: *The leaderboard and address tracker reveal required parameters one per call (`timeFrame` → `sortBy`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Keys**: `L_leaderboard`, `L_address_tracker`

### Exact Request 1 (`L_leaderboard` missing `timeFrame`)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/leaderboard/list`
- **Query Parameters**:
  - `binanceChainId`: `56`

### Exact Response Snippet 1
```json
  "body": {
   "code": 40001,
   "msg": "timeFrame is required",
   "data": null,
   "timestamp": 1791032430676,
   "success": false
  }
```

### Exact Request 2 (`L_address_tracker` missing `trackerType`)
- **HTTP Method**: `GET`
- **Path**: `/api/v1/dex/market/address-tracker/trades`
- **Query Parameters**:
  - `binanceChainId`: `56`
  - `walletAddress`: `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`

### Exact Response Snippet 2
```json
  "body": {
   "code": 40001,
   "msg": "trackerType is required",
   "data": null,
   "timestamp": 1791032431571,
   "success": false
  }
```

---

## 12. Public BSC RPC refuses `eth_getLogs` at any block range

- **Reference**: `MODULES.md` §6, Item 12: *Public BSC RPC (`bsc-dataseed`) refuses `eth_getLogs` at any range, 5 blocks included (`F_logs.providers.public_dataseed`).*
- **Source File**: `spike/results/module_probes_20261003T130122Z.json`
- **Probe Key**: `F_logs.providers.public_dataseed`

### Exact Request
- **JSON-RPC Method**: `eth_getLogs`
- **Endpoint**: `https://bsc-dataseed.bnbchain.org`
- **Parameters**:
  - `address`: `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` (NVDAB)
  - `topics`: `["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]` (Transfer event topic)
  - `fromBlock`: `hex(head - window)`
  - `toBlock`: `hex(head)`

### Exact Response Snippet
Every tested window from 10,000 blocks down to 5 blocks fails with code `-32005` (`limit exceeded`):
```json
"public_dataseed": {
    "head": 125488631,
    "windowErrors": {
     "10000": "{'code': -32005, 'message': 'limit exceeded'}",
     "5000": "{'code': -32005, 'message': 'limit exceeded'}",
     "2000": "{'code': -32005, 'message': 'limit exceeded'}",
     "1000": "{'code': -32005, 'message': 'limit exceeded'}",
     "500": "{'code': -32005, 'message': 'limit exceeded'}",
     "100": "{'code': -32005, 'message': 'limit exceeded'}",
     "50": "{'code': -32005, 'message': 'limit exceeded'}",
     "20": "{'code': -32005, 'message': 'limit exceeded'}",
     "10": "{'code': -32005, 'message': 'limit exceeded'}",
     "5": "{'code': -32005, 'message': 'limit exceeded'}"
    }
   }
```
