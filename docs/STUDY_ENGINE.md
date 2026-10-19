# Study & progress engine

Everything here is computed locally from your data; there is no server-side learning model.

## Spaced repetition (SM-2 variant)

Each command and concept has one scheduling state in `study/srs-state.json` (ease, interval, due date, repetitions, lapses). Commands also mirror it in their `srs` field.

| Rating | Effect                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------ |
| Again  | repetitions reset, ease −0.2 (min 1.3), card returns in 10 minutes and again at the end of the session |
| Hard   | ease −0.14; 1 d → 4 d → interval × 1.2                                                                 |
| Good   | ease unchanged; 1 d → 6 d → interval × ease                                                            |
| Easy   | ease +0.1 (max 3.0); 3 d → 8 d → interval × ease × 1.3                                                 |

Intervals never shrink on a pass and are capped at 10 years. **Mastery** follows the interval: reviewed once = 1, interval ≥ 6 d = 2, ≥ 21 d = 3. A lapse drops it back toward 1. Concept **confidence** is set the same way.

New cards are limited per day (Settings → Study, default 10). Due reviews always appear.

## Card types

`name` (what does X do), `task` (type the command), `flag` (what does `-a` do), `fill` (fill the blank), and for concepts `teach` (intuition) / `what`. The type is chosen from what the entry contains and from its mastery (easier cards first). Typed answers ignore whitespace, flag order and clustering (`-la` = `-l -a`) and a leading `$`; arguments keep their order; `<placeholders>` in the reference match any value.

## Skill map

Per domain, 0–100: concepts ≤ 35 (difficulty × confidence, saturating at 6) + commands ≤ 25 (Σ mastery/3, saturating at 10) + labs ≤ 30 (completed lab difficulty 1/2/3, saturating at 8) + recency ≤ 10 (e^(−days/30)). Entries join a domain through its aliases (category, tags, lab domain, or the concepts a lab uses); edit domains, weights and aliases in `config/skills.json`. A daily snapshot in `study/skill-history.json` powers the weekly trend.

## Threat level

`score = 10 × days since last activity + 2 × cards overdue > 3 days (max 20) − 3 × streak days (max 14)`. LOW < 20, MODERATE < 50, ELEVATED < 90, HIGH otherwise. Only creating, editing, studying and lab work count as activity; importing does not. Days follow your local timezone.

## Recommendations

Ordered by priority, each with its reason: due cards, weakest weighted domain you have started, labs in progress, concepts no lab uses yet, commands unpractised for 14 days (or never), and open questions.
