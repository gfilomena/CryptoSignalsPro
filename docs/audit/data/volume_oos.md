# Volume study — BTCUSDT spot 1h (OOS ONLY); returns are RAW (long), from the close of the bar the volume readings belong to
excess = mean forward return of the bucket minus the unconditional mean over the same range; CI = seeded bootstrap of the bucket mean minus that baseline (gross of costs)
| relative volume | taker imbalance | n | fwd 1h excess [95% CI] | fwd 4h excess [95% CI] | fwd 24h excess [95% CI] | %up 4h |
|---|---|---|---|---|---|---|
| RV<0.8 | sell-dominated (TBR<=0.47) | 967 | -0.025% [-0.052%, -0.001%] * | -0.022% [-0.076%, 0.031%] | -0.016% [-0.172%, 0.136%] | 50.7% |
| RV<0.8 | balanced | 770 | 0.010% [-0.018%, 0.039%] | -0.031% [-0.100%, 0.034%] | -0.173% [-0.340%, -0.008%] * | 47.5% |
| RV<0.8 | buy-dominated (TBR>=0.53) | 860 | -0.009% [-0.034%, 0.016%] | -0.018% [-0.079%, 0.045%] | -0.020% [-0.168%, 0.123%] | 47.7% |
| 0.8-1.5 | sell-dominated (TBR<=0.47) | 624 | 0.007% [-0.032%, 0.044%] | 0.065% [-0.007%, 0.139%] | 0.116% [-0.090%, 0.309%] | 51.3% |
| 0.8-1.5 | balanced | 485 | 0.004% [-0.050%, 0.055%] | -0.012% [-0.091%, 0.071%] | -0.007% [-0.235%, 0.222%] | 50.1% |
| 0.8-1.5 | buy-dominated (TBR>=0.53) | 630 | 0.012% [-0.022%, 0.047%] | -0.026% [-0.094%, 0.042%] | 0.058% [-0.128%, 0.234%] | 48.3% |
| 1.5-2.5 | sell-dominated (TBR<=0.47) | 240 | 0.055% [-0.015%, 0.131%] | 0.010% [-0.132%, 0.155%] | -0.028% [-0.380%, 0.316%] | 54.2% |
| 1.5-2.5 | balanced | 192 | -0.031% [-0.120%, 0.058%] | -0.014% [-0.176%, 0.149%] | -0.160% [-0.551%, 0.218%] | 51.6% |
| 1.5-2.5 | buy-dominated (TBR>=0.53) | 212 | -0.024% [-0.110%, 0.061%] | 0.072% [-0.082%, 0.234%] | 0.248% [-0.050%, 0.553%] | 49.1% |
| RV>=2.5 | sell-dominated (TBR<=0.47) | 120 | 0.040% [-0.093%, 0.164%] | 0.133% [-0.068%, 0.330%] | 0.124% [-0.327%, 0.541%] | 60.0% |
| RV>=2.5 | balanced | 58 | -0.087% [-0.270%, 0.114%] | 0.022% [-0.264%, 0.297%] | 0.028% [-0.560%, 0.651%] | 58.6% |
| RV>=2.5 | buy-dominated (TBR>=0.53) | 103 | 0.089% [-0.046%, 0.241%] | 0.098% [-0.127%, 0.331%] | 0.296% [-0.170%, 0.811%] | 46.6% |

`*` = 95% CI excludes 0 (12 cells x 3 horizons = 36 tests: ~2 false positives expected by chance alone; only a cell that repeats with the same sign out-of-sample would count).
Round-trip cost to beat: 0.12%.
