# Volume study — BTCUSDT spot 1h (decision range: train+val); returns are RAW (long), from the close of the bar the volume readings belong to
excess = mean forward return of the bucket minus the unconditional mean over the same range; CI = seeded bootstrap of the bucket mean minus that baseline (gross of costs)
| relative volume | taker imbalance | n | fwd 1h excess [95% CI] | fwd 4h excess [95% CI] | fwd 24h excess [95% CI] | %up 4h |
|---|---|---|---|---|---|---|
| RV<0.8 | sell-dominated (TBR<=0.47) | 4631 | 0.002% [-0.009%, 0.013%] | 0.002% [-0.022%, 0.025%] | -0.036% [-0.099%, 0.028%] | 53.4% |
| RV<0.8 | balanced | 3628 | 0.010% [-0.004%, 0.025%] | -0.028% [-0.058%, 0.001%] | 0.029% [-0.048%, 0.106%] | 50.1% |
| RV<0.8 | buy-dominated (TBR>=0.53) | 2515 | -0.011% [-0.027%, 0.006%] | -0.021% [-0.055%, 0.013%] | -0.015% [-0.108%, 0.072%] | 48.8% |
| 0.8-1.5 | sell-dominated (TBR<=0.47) | 2470 | 0.017% [-0.003%, 0.036%] | 0.038% [0.000%, 0.076%] * | -0.005% [-0.106%, 0.088%] | 55.3% |
| 0.8-1.5 | balanced | 2263 | 0.013% [-0.010%, 0.037%] | 0.027% [-0.021%, 0.071%] | 0.005% [-0.092%, 0.103%] | 52.0% |
| 0.8-1.5 | buy-dominated (TBR>=0.53) | 1777 | -0.023% [-0.046%, -0.000%] * | -0.023% [-0.069%, 0.022%] | -0.027% [-0.139%, 0.083%] | 47.5% |
| 1.5-2.5 | sell-dominated (TBR<=0.47) | 894 | 0.028% [-0.014%, 0.070%] | 0.070% [-0.005%, 0.146%] | 0.096% [-0.065%, 0.257%] | 56.6% |
| 1.5-2.5 | balanced | 862 | -0.044% [-0.089%, 0.000%] | -0.017% [-0.095%, 0.068%] | 0.112% [-0.079%, 0.295%] | 47.9% |
| 1.5-2.5 | buy-dominated (TBR>=0.53) | 725 | -0.005% [-0.049%, 0.040%] | 0.040% [-0.040%, 0.124%] | 0.005% [-0.171%, 0.177%] | 49.8% |
| RV>=2.5 | sell-dominated (TBR<=0.47) | 500 | -0.025% [-0.093%, 0.041%] | -0.048% [-0.153%, 0.056%] | 0.017% [-0.216%, 0.247%] | 50.6% |
| RV>=2.5 | balanced | 353 | -0.034% [-0.107%, 0.036%] | -0.096% [-0.232%, 0.038%] | -0.156% [-0.392%, 0.082%] | 49.0% |
| RV>=2.5 | buy-dominated (TBR>=0.53) | 401 | -0.017% [-0.082%, 0.046%] | 0.047% [-0.067%, 0.167%] | 0.052% [-0.176%, 0.287%] | 50.6% |

`*` = 95% CI excludes 0 (12 cells x 3 horizons = 36 tests: ~2 false positives expected by chance alone; only a cell that repeats with the same sign out-of-sample would count).
Round-trip cost to beat: 0.12%.
