# When the Model Says "Holup"

[![Live Alert Planner](https://img.shields.io/badge/Live_alert_planner-open-117F8D?style=for-the-badge&logo=githubpages)](https://siddhantdamre.github.io/When-the-Model-Says-Holup/)
[![Portfolio Guide](https://img.shields.io/badge/Portfolio-context-0969DA?style=for-the-badge&logo=github)](https://github.com/Siddhantdamre/Siddhantdamre/blob/main/PORTFOLIO.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Holup has two connected surfaces:

- a [live alert budget planner](https://siddhantdamre.github.io/When-the-Model-Says-Holup/) that accepts scored SOC, SRE, fraud, or operations alerts and allocates a fixed human-review-time budget
- a benchmark for metacognitive reasoning under partial observability

The browser planner runs without keys and keeps alert data local. It routes
high-confidence alerts, prioritizes uncertain high-impact cases for human
review, plots the budget-to-capture curve, and exports the routed queue as CSV.

This repository tests whether models can correctly distinguish among:
- `COMMIT`: evidence is sufficient for a conclusion
- `ABSTAIN`: evidence is insufficient, but there is no contradiction or trust collapse
- `ESCALATE`: contradiction, trust failure, or model insufficiency requires outside review

The core result is simple but important:

> Small open models can avoid bluffing and silent failure while still failing metacognitively by collapsing ordinary uncertainty into escalation instead of using abstention correctly.

This benchmark does more than rank models by one score. It separates distinct metacognitive failure modes.

## Recruiter Quick Look

| What to check | Why it matters |
| --- | --- |
| [Live alert planner](https://siddhantdamre.github.io/When-the-Model-Says-Holup/) | Turns a real CSV and review-minute budget into an inspectable routing queue. |
| `benchmarks/exec_meta_adapt/frontier/` | Frozen task set, parser, and scorer contract. |
| `benchmarks/exec_meta_adapt/frontier_local/` | Local/open-weight model runner without API dependency. |
| `results/` | Scored outputs for current model comparisons. |
| `docs/releases/` | Submission-ready result writeups and figures. |
| `docs/DEMO_ROADMAP.md` | Concrete path to a richer leaderboard/demo. |

---

## Direct Use: Alert Budget Planner

The app requires `id,score` and accepts optional
`title,severity,estimated_loss,review_minutes,label,source` columns. Its
transparent review value combines uncertainty, severity, estimated impact, and
review time. If labels are supplied, the curve reports observed positive-alert
capture; otherwise it reports expected weighted-risk capture.

This is a policy-planning aid, not an autonomous incident-response policy.
Operational use requires calibrated scores, organization-specific costs,
access controls, monitoring, and analyst feedback.

---

## Why This Benchmark Exists

Many safety-style evaluations reward not bluffing. That matters, but it is not enough.

A model can look safe simply by escalating too often. This benchmark is built to detect that difference.

It asks whether a model can tell apart:
- ordinary uncertainty, where `ABSTAIN` is correct
- genuine trust failure or structural contradiction, where `ESCALATE` is correct
- sufficiently supported cases, where `COMMIT` is correct

---

## Main Finding

Across the current open-weight model slice, the benchmark separates at least three failure modes:

- **Over-escalation collapse**: `qwen`, `smollm`
- **Under-escalation / over-abstention tradeoff**: `granite`
- **Parse / bluff fragility**: `tinyllama`

That makes the benchmark useful for studying metacognitive behavior, not just final accuracy.

---

## Visual Summary

![Open-weight metacognition expansion](docs/releases/frontier_local_metacognition_expansion.svg)

---

## Main Result Table

| Model | Final Acc | Abstain | Bluff | Escalate | Silent Failure | Parse Error |
|---|---:|---:|---:|---:|---:|---:|
| `granite` | `0.53` | `0.55` | `0.00` | `0.05` | `0.00` | `0.15` |
| `qwen` | `0.72` | `0.05` | `0.00` | `0.75` | `0.00` | `0.00` |
| `smollm` | `0.75` | `0.00` | `0.00` | `0.75` | `0.00` | `0.00` |
| `tinyllama` | `0.17` | `0.00` | `0.30` | `0.00` | `0.05` | `0.53` |

Interpretation:
- `qwen` and `smollm` are safe in the narrow sense, but over-escalatory.
- `granite` handles ordinary uncertainty better, but under-escalates when escalation is truly required.
- `tinyllama` is a fragility baseline with parse failures and bluffing.

---

## Repository Layout

| Path | Purpose |
|---|---|
| `benchmarks/exec_meta_adapt/frontier/` | frozen task set, prompt builder, parser, scorer |
| `benchmarks/exec_meta_adapt/frontier_local/` | no-API local/open-weight runners |
| `docs/releases/` | benchmark notes, result writeups, and figures |
| `notebooks/` | submission notebook |
| `submission/` | packaged submission artifacts |
| `results/` | scored run outputs for the main local benchmarks |

---

## Quick Start

Install dependencies:

```bash
python -m pip install transformers accelerate sentencepiece
```

Run the baseline local benchmark:

```bash
python benchmarks/exec_meta_adapt/frontier_local/run_frontier_local.py --models qwen smollm --tasks benchmarks/exec_meta_adapt/frontier/frontier_tasks_metacog.jsonl --output results/frontier_local/full_40/
```

Run the 4-model expansion:

```bash
python benchmarks/exec_meta_adapt/frontier_local/run_frontier_local.py --models granite qwen smollm tinyllama --tasks benchmarks/exec_meta_adapt/frontier/frontier_tasks_metacog.jsonl --output results/frontier_local/open_model_expansion/full_40_single/
```

---

## Key Files

- `benchmarks/exec_meta_adapt/frontier/frontier_tasks_metacog.jsonl`
- `benchmarks/exec_meta_adapt/frontier/scoring_frontier.py`
- `benchmarks/exec_meta_adapt/frontier_local/run_frontier_local.py`
- `benchmarks/exec_meta_adapt/frontier_local/run_frontier_local_expansion.py`
- `docs/releases/frontier_local_submission_bundle.md`
- `docs/releases/frontier_local_metacognition_expansion.md`
- `notebooks/frontier_local_metacognition_submission.ipynb`

---

## Scope

This repository is about metacognitive benchmarking under hidden-state uncertainty.

It does claim:
- a reusable benchmark for `COMMIT` vs `ABSTAIN` vs `ESCALATE`
- open-weight baseline comparisons
- evidence that models can be safe-looking while still metacognitively miscalibrated

---

## Submission Form

The strongest submission form for this project is:

1. **Primary benchmark notebook**: a Kaggle notebook or equivalent public notebook that runs the benchmark story end to end
2. **Linked GitHub repository**: this repo, containing the frozen task set, runner, scoring, figures, and result artifacts
3. **Short writeup or abstract**: the benchmark claim, task taxonomy, metrics, main table, figure, limitations, and reproduction commands

For this repository, the submission-facing assets are already bundled under:
- `docs/releases/`
- `notebooks/`
- `submission/`

See `SUBMISSION.md` for a concise checklist.

---

## Contributing

Contributions are welcome, but the benchmark contract should remain stable unless there is a factual bug.

Please read:
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CITATION.cff`
