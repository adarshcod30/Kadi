# KADI — provisioned access

> **These accounts guard a synthetic corpus.** Every FIR, offender and address in KADI is
> generated data. No account here reaches a real police record, and none of these passwords
> is reused from any real system. They are published so the access model can be checked
> rather than believed: sign in as SP Mysuru and confirm for yourself that Bengaluru City
> is genuinely unreachable, not merely hidden.

All addresses are on `@ksp.gov.in`. Sign-in is at `/app/login`.

## How scope works

| Tier | What the account reads | Can it switch? |
|---|---|---|
| State | All 31 districts | Yes — may drill into any district and back out |
| District | Exactly one district, plus cases linked into it | No — pinned to its own district |
| Station | Exactly one station register | No — pinned to its own station |

Scope is enforced server-side on every query. Editing the URL does not widen it.

## State tier

| Email | Password | Post | Reads |
|---|---|---|---|
| `dgp@ksp.gov.in` | `9qxZWxD2EGCkxa` | DGP Karnataka | All 31 districts. Approves sign-up requests. |
| `scrb.analyst@ksp.gov.in` | `jzX5FKjHA3A9nM` | SCRB Analyst | All 31 districts, analytics and forecasting. |
| `admin@ksp.gov.in` | `GEQVN4U7Jr8bjR` | System Administrator | State tier plus audit and fairness. Approves sign-ups. |

## District tier

| Email | Password | Post | Reads |
|---|---|---|---|
| `sp.bengalurucity@ksp.gov.in` | `HXaHVCXynukNbB` | SP Bengaluru City | Bengaluru City only. Cannot read another district. |
| `sp.bengalururural@ksp.gov.in` | `GMUaAQ4pbPYUdg` | SP Bengaluru Rural | Bengaluru Rural only. Cannot read another district. |
| `sp.mysuru@ksp.gov.in` | `NQhjMtznT7mHWa` | SP Mysuru | Mysuru only. Cannot read another district. |
| `sp.mandya@ksp.gov.in` | `fh6y6x8hgcdWn7` | SP Mandya | Mandya only. Cannot read another district. |
| `sp.hassan@ksp.gov.in` | `Zg9f8bCXPRcfBz` | SP Hassan | Hassan only. Cannot read another district. |
| `sp.tumakuru@ksp.gov.in` | `MdqjGpBxNZTGkE` | SP Tumakuru | Tumakuru only. Cannot read another district. |
| `sp.kalaburagi@ksp.gov.in` | `8mmDKE9hZCbPCd` | SP Kalaburagi | Kalaburagi only. Cannot read another district. |
| `sp.ballari@ksp.gov.in` | `S4bC4KpNJNftCz` | SP Ballari | Ballari only. Cannot read another district. |
| `sp.vijayapura@ksp.gov.in` | `MmS8fUkzB8GXFc` | SP Vijayapura | Vijayapura only. Cannot read another district. |
| `sp.belagavi@ksp.gov.in` | `cQNfKrabDERMPs` | SP Belagavi | Belagavi only. Cannot read another district. |
| `sp.dharwad@ksp.gov.in` | `bPbbJKxFdMcyFM` | SP Dharwad | Dharwad only. Cannot read another district. |
| `sp.hubballidharwad@ksp.gov.in` | `c6qxdx23kkgdGz` | SP Hubballi-Dharwad | Hubballi-Dharwad only. Cannot read another district. |
| `sp.udupi@ksp.gov.in` | `K52kHhPzKye8ne` | SP Udupi | Udupi only. Cannot read another district. |
| `sp.dakshinakannada@ksp.gov.in` | `mEmmPE9wtJ7J4T` | SP Dakshina Kannada | Dakshina Kannada only. Cannot read another district. |
| `sp.uttarakannada@ksp.gov.in` | `NNnLm6mxNxm9tq` | SP Uttara Kannada | Uttara Kannada only. Cannot read another district. |
| `sp.shivamogga@ksp.gov.in` | `SCLPgrvBqCn6W6` | SP Shivamogga | Shivamogga only. Cannot read another district. |
| `sp.chitradurga@ksp.gov.in` | `reMJKKgDUPTQV6` | SP Chitradurga | Chitradurga only. Cannot read another district. |
| `sp.davanagere@ksp.gov.in` | `pEpGKFwQ2tf6NY` | SP Davanagere | Davanagere only. Cannot read another district. |
| `sp.kolar@ksp.gov.in` | `MkBmDKwpZpNjTQ` | SP Kolar | Kolar only. Cannot read another district. |
| `sp.chikkaballapura@ksp.gov.in` | `gAs5wSEWWypSbM` | SP Chikkaballapura | Chikkaballapura only. Cannot read another district. |
| `sp.ramanagara@ksp.gov.in` | `6DdUS7CR2sVRwL` | SP Ramanagara | Ramanagara only. Cannot read another district. |
| `sp.chamarajanagar@ksp.gov.in` | `gMMN3Gy6yrHRmn` | SP Chamarajanagar | Chamarajanagar only. Cannot read another district. |
| `sp.kodagu@ksp.gov.in` | `PymSDKng5buMYn` | SP Kodagu | Kodagu only. Cannot read another district. |
| `sp.chikkamagaluru@ksp.gov.in` | `TdYSGa2cdJYNDh` | SP Chikkamagaluru | Chikkamagaluru only. Cannot read another district. |
| `sp.haveri@ksp.gov.in` | `B24SsKDGa5g9F7` | SP Haveri | Haveri only. Cannot read another district. |
| `sp.gadag@ksp.gov.in` | `evTR6mYYQ3NTEV` | SP Gadag | Gadag only. Cannot read another district. |
| `sp.bagalkote@ksp.gov.in` | `c3SjN86ktJ79MG` | SP Bagalkote | Bagalkote only. Cannot read another district. |
| `sp.koppal@ksp.gov.in` | `key4yLezHbx5P4` | SP Koppal | Koppal only. Cannot read another district. |
| `sp.raichur@ksp.gov.in` | `vTjQ5fcPZxHYCa` | SP Raichur | Raichur only. Cannot read another district. |
| `sp.yadgir@ksp.gov.in` | `NGmueuqxvENpb9` | SP Yadgir | Yadgir only. Cannot read another district. |
| `sp.bidar@ksp.gov.in` | `2vBZfLuRej6sQW` | SP Bidar | Bidar only. Cannot read another district. |

## Station tier

| Email | Password | Post | Reads |
|---|---|---|---|
| `sho.bengalurubazaar@ksp.gov.in` | `JJP6tq6YDeW6DV` | SHO Bengaluru Bazaar PS | Bengaluru Bazaar PS only. |
| `si.bengalurubazaar@ksp.gov.in` | `qJrUCymdsTrU8a` | PSI Bengaluru Bazaar PS | Bengaluru Bazaar PS only. |

## Signing up

New officers register at `/app/login` with an `@ksp.gov.in` address and request a tier.
The account is created **pending** and cannot sign in until the DGP or the Administrator
approves it from Admin → Access requests. This is the approval chain, not a formality:
a pending account is refused at the login endpoint, not merely hidden in the interface.

## Demo access

The three tier cards on the sign-in page enter without credentials, for evaluation. The
demo district tier may switch freely between districts; a real SP account cannot. That
difference is the point of having both.

---

Generated by `scripts/seed_accounts.js` on 2026-08-26.
Re-running it regenerates every password and invalidates this list.
