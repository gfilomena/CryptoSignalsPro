import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { MAIN_HORIZONS } from '../../lib/analyzer/config'
import type { AnalyzerResult, HorizonResult } from '../../lib/analyzer/analyzer'
import { initAnalyzer, runAnalysis, type ValidationFile } from '../../lib/analyzer/analyzerClient'
import { buildSnapshot, fetchLiveInputs, AnalyzerDataError, type AnalyzerSnapshot } from '../../lib/analyzer/liveSnapshot'
import { addRecord, loadRecords, makeRecord, mergeRecords, pullRemote, pushRemote, resolveAll, saveRecords, summarizePerformance, OUTCOME_HORIZONS, type AnalysisRecord } from '../../lib/analyzer/history'
import type { StoreMeta } from '../../lib/analyzer/store'
import type { SignalSnapshot } from '../../types/scalpSignal'

interface Props { engineSnapshot: SignalSnapshot | null }

const WINDOWS: (number | null)[] = [null, 730, 365, 180, 90, 30]
const FLAT_STATES = ['NO_TRADE', 'WATCH', 'EXPIRED', 'TARGET_HIT', 'STOP_HIT']

const pc = (x: number | null | undefined, d = 1): string => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`)
const date = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const num = (x: number | null | undefined, d = 2): string => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d))

function engineInfo(s: SignalSnapshot | null): { state: string | null; direction: 'long' | 'short' | null; flat: boolean } {
  if (!s) return { state: null, direction: null, flat: false }
  const dir = s.state.startsWith('LONG') ? 'long' : s.state.startsWith('SHORT') ? 'short' : s.setup?.direction ?? null
  return { state: s.state, direction: s.state === 'TRADE_ACTIVE' ? (s.setup?.direction ?? null) : dir, flat: FLAT_STATES.includes(s.state) }
}

export function SetupAnalyzerPanel({ engineSnapshot }: Props) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<AnalyzerSnapshot | null>(null)
  const [result, setResult] = useState<AnalyzerResult | null>(null)
  const [record, setRecord] = useState<AnalysisRecord | null>(null)
  const [meta, setMeta] = useState<StoreMeta | null>(null)
  const [validation, setValidation] = useState<ValidationFile | null>(null)
  const [windowDays, setWindowDays] = useState<number | null>(null)
  const [records, setRecords] = useState<AnalysisRecord[]>(() => loadRecords())

  // resolve outcomes of past analyses (post-event validation) once on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const remote = await pullRemote()
      const merged = mergeRecords(loadRecords(), remote)
      const { records: resolved, changed } = await resolveAll(merged)
      if (cancelled) return
      saveRecords(resolved)
      setRecords(resolved)
      for (const c of changed) void pushRemote(c)
    })()
    return () => { cancelled = true }
  }, [])

  const analyzeNow = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const init = await initAnalyzer()
      setMeta(init.meta)
      setValidation(init.validation)
      const snap = buildSnapshot(await fetchLiveInputs())
      const res = await runAnalysis(snap.t, snap.vector, windowDays)
      const rec = makeRecord(snap, res, engineInfo(engineSnapshot))
      setSnapshot(snap)
      setResult(res)
      setRecord(rec)
      setRecords((prev) => addRecord(prev, rec))
      void pushRemote(rec)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof AnalyzerDataError ? t('analyzer.dataError', { reason: e.reason }) : t('analyzer.loadError', { reason: (e as Error).message }))
      setStatus('error')
    }
  }, [engineSnapshot, t, windowDays])

  const perf = useMemo(() => summarizePerformance(records), [records])
  const oos = validation?.results.oos

  return (
    <div className="msa" id="setupAnalyzer">
      <div className="msa-header">
        <div>
          <div className="msa-title">🔍 {t('analyzer.title')}</div>
          <div className="msa-sub">{t('analyzer.subtitle')}</div>
        </div>
        <div className="msa-actions">
          <label className="msa-window">
            {t('analyzer.window')}
            <select value={windowDays ?? 'all'} onChange={(e) => setWindowDays(e.target.value === 'all' ? null : Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={String(w)} value={w ?? 'all'}>{w === null ? t('analyzer.windowAll') : t('analyzer.windowDays', { d: w })}</option>
              ))}
            </select>
          </label>
          <button type="button" className="bt-run-btn" disabled={status === 'loading'} onClick={analyzeNow}>
            {status === 'loading' ? t('analyzer.analyzing') : t('analyzer.button')}
          </button>
        </div>
      </div>
      <p className="msa-disclaimer">{t('analyzer.disclaimer')}</p>

      {status === 'error' && <div className="msa-error">{error}</div>}

      {result && snapshot && record && meta && (
        <ResultView result={result} snapshot={snapshot} record={record} meta={meta} validation={validation} />
      )}

      <details className="msa-details">
        <summary>{t('analyzer.historyTitle')} ({perf.total})</summary>
        <div className="msa-note">{t('analyzer.historyHint')}</div>
        <div className="msa-counts">
          {t('analyzer.histCounts', { total: perf.total, bull: perf.bullish, bear: perf.bearish, neut: perf.neutral, insuf: perf.insufficient })}
        </div>
        <table className="msa-table">
          <thead><tr><th>{t('analyzer.horizon')}</th><th>{t('analyzer.resolved')}</th><th>{t('analyzer.positive')}</th><th>{t('analyzer.negative')}</th><th>{t('analyzer.mean')}</th><th>{t('analyzer.median')}</th></tr></thead>
          <tbody>
            {OUTCOME_HORIZONS.map((h) => {
              const x = perf.byHorizon[h]
              return <tr key={h}><td>{h}</td><td>{x.resolved}</td><td>{pc(x.pPositive)}</td><td>{pc(x.pNegative)}</td><td>{pc(x.meanRet, 3)}</td><td>{pc(x.medianRet, 3)}</td></tr>
            })}
          </tbody>
        </table>
        {records.slice(0, 8).map((r) => (
          <div key={r.id} className="msa-hist-row">
            <span>{new Date(r.snapshotTimeMs).toLocaleString()}</span>
            <span className={`msa-badge ${r.bias}`}>{t(`analyzer.bias.${r.bias}`)}</span>
            <span>{r.strength === null ? '—' : `${r.strength}/100`}</span>
            <span>{OUTCOME_HORIZONS.filter((h) => r.outcomes[h]).map((h) => `${h} ${pc(r.outcomes[h].ret, 2)}`).join(' · ') || t('analyzer.pending')}</span>
          </div>
        ))}
      </details>
      {oos && <div className="msa-note">{t('analyzer.validationShort', { q: oos.queries })}</div>}
    </div>
  )
}

function ResultView({ result, snapshot, record, meta, validation }: { result: AnalyzerResult; snapshot: AnalyzerSnapshot; record: AnalysisRecord; meta: StoreMeta; validation: ValidationFile | null }) {
  const { t } = useI18n()
  const main = result.horizons.filter((h) => (MAIN_HORIZONS as readonly string[]).includes(h.horizon))
  const insufficient = result.bias === 'INSUFFICIENT'
  const h1 = result.horizons.find((h) => h.horizon === '1h')!
  const h30 = result.horizons.find((h) => h.horizon === '30m')!
  const directional = result.bias === 'BULLISH' || result.bias === 'BEARISH'
  const interp = directional
    ? result.confirmation === 'NONE'
      ? 'weakLean'
      : result.bias === 'BULLISH' ? 'bullish' : 'bearish'
    : insufficient ? 'insufficient' : 'none'
  const weak = !insufficient && (result.strength ?? 0) < 20 // below the 'weak' bin of the strength scale

  const statement = (h: HorizonResult) =>
    h.sample === 'INSUFFICIENT'
      ? t('analyzer.stmtInsufficient', { h: h.horizon, n: h.nEff })
      : t('analyzer.statement', { n: h.nEff, h: h.horizon, p: (h.pPositive.p * 100).toFixed(1), lo: (h.pPositive.lo * 100).toFixed(1), hi: (h.pPositive.hi * 100).toFixed(1), base: (h.baseline.all.pPositive * 100).toFixed(1), from: date(result.poolFromMs), to: date(result.poolToMs) })

  return (
    <div className="msa-result">
      <div className="msa-note">
        {t('analyzer.frozen', { time: new Date(snapshot.t).toISOString().replace('T', ' ').slice(0, 16), price: snapshot.display.price.toLocaleString('en-US', { maximumFractionDigits: 1 }) })} · {t('analyzer.storeInfo', { n: meta.n, from: date(meta.dataStartMs), to: date(meta.dataEndMs), tau: result.tau.toFixed(2), v: result.storeVersion })}
      </div>

      <div className="msa-summary">
        <div className="msa-card">
          <div className="msa-card-k">{t('analyzer.engine')}</div>
          <div className="msa-card-v">{record.engineState ?? '—'}</div>
        </div>
        <div className="msa-card">
          <div className="msa-card-k">{t('analyzer.biasLabel')}</div>
          <div className={`msa-card-v msa-badge ${result.bias}`}>{t(`analyzer.bias.${result.bias}`)}</div>
          <div className="msa-card-s">{t('analyzer.notAction')}</div>
        </div>
        <div className="msa-card">
          <div className="msa-card-k">{t('analyzer.strength')}</div>
          <div className="msa-card-v">{result.strength === null ? '—' : `${result.strength}/100`}</div>
          <div className="msa-card-s">{t(`analyzer.conf.${result.confirmation}`)} · {t('analyzer.strengthHint')}</div>
        </div>
        <div className="msa-card">
          <div className="msa-card-k">{t('analyzer.status')}</div>
          <div className={`msa-card-v msa-align ${record.alignment}`}>{t(`analyzer.align.${record.alignment}`)}</div>
          {record.alignment === 'CONFLICTING' && <div className="msa-card-s">{t('analyzer.conflictHint')}</div>}
        </div>
      </div>

      <p className="msa-interp">{t(`analyzer.interp.${interp}`, { dir: directional ? t(`analyzer.dir.${result.bias}`) : '' })}{weak && ` · ${t('analyzer.weakEvidence')}`}</p>
      <div className="msa-meta">
        <span>{t('analyzer.comparable', { n: result.horizons.find((h) => h.horizon === '1h')?.nEff ?? 0, raw: result.nAnalogs, cand: result.nCandidates })}</span>
        <span className={`msa-sample ${h1.sample}`}>{t(`analyzer.sample.${h1.sample}`)}</span>
        <span>{t('analyzer.period', { from: date(result.poolFromMs), to: date(result.poolToMs) })}</span>
        <span>{t('analyzer.similarity', { mean: num(result.distance.mean, 2), tau: result.tau.toFixed(2) })}</span>
        {result.robustness && <span className={`msa-rob ${result.robustness.verdict}`}>{t(`analyzer.robust.${result.robustness.verdict}`)}</span>}
      </div>

      {!insufficient && (
        <>
          <p className="msa-statement">{statement(h30)}</p>
          <p className="msa-statement">{statement(h1)}</p>
        </>
      )}

      <table className="msa-table">
        <thead>
          <tr><th>{t('analyzer.horizon')}</th><th>{t('analyzer.positive')}</th><th>{t('analyzer.negative')}</th><th>N</th><th>{t('analyzer.mean')}</th><th>{t('analyzer.median')}</th><th>MFE / MAE</th><th>{t('analyzer.sampleCol')}</th></tr>
        </thead>
        <tbody>
          {main.map((h) => (
            <tr key={h.horizon}>
              <td>{h.horizon}</td>
              <td>{pc(h.pPositive.p)} <small>[{pc(h.pPositive.lo, 0)}–{pc(h.pPositive.hi, 0)}]</small></td>
              <td>{pc(h.pNegative.p)}</td>
              <td>{h.nEff} <small>({h.nRaw})</small></td>
              <td>{pc(h.meanRet, 3)}</td>
              <td>{pc(h.medianRet, 3)}</td>
              <td>{pc(h.meanMfe, 2)} / {pc(h.meanMae, 2)}</td>
              <td className={`msa-sample ${h.sample}`}>{t(`analyzer.sample.${h.sample}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="msa-note">{t('analyzer.tableNote')}</div>

      <details className="msa-details">
        <summary>{t('analyzer.moreThresholds')}</summary>
        <table className="msa-table">
          <thead><tr><th>{t('analyzer.horizon')}</th><th>&gt;+0.25%</th><th>&gt;+0.5%</th><th>&gt;+1%</th><th>&lt;−0.25%</th><th>&lt;−0.5%</th><th>&lt;−1%</th><th>{t('analyzer.maxDd')}</th><th>{t('analyzer.timeTo')}</th></tr></thead>
          <tbody>
            {result.horizons.map((h) => (
              <tr key={h.horizon}>
                <td>{h.horizon}</td>
                {['0.25%', '0.5%', '1%'].map((k) => <td key={`u${k}`}>{pc(h.pUp[k]?.p)}</td>)}
                {['0.25%', '0.5%', '1%'].map((k) => <td key={`d${k}`}>{pc(h.pDown[k]?.p)}</td>)}
                <td>{pc(h.meanMaxDrawdown, 2)}</td>
                <td>{num(h.medianMinutesToMfe, 0)}′ / {num(h.medianMinutesToMae, 0)}′</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className="msa-details">
        <summary>{t('analyzer.baselines')}</summary>
        <div className="msa-note">{t('analyzer.baselinesNote')}</div>
        <table className="msa-table">
          <thead><tr><th>{t('analyzer.horizon')}</th><th>{t('analyzer.analogs')}</th><th>{t('analyzer.baseAll')}</th><th>{t('analyzer.baseRegime')}</th><th>{t('analyzer.baseMom')}</th><th>{t('analyzer.excess')}</th><th>p</th></tr></thead>
          <tbody>
            {main.map((h) => (
              <tr key={h.horizon}>
                <td>{h.horizon}</td><td>{pc(h.pPositive.p)}</td><td>{pc(h.baseline.all.pPositive)}</td><td>{pc(h.baseline.sameRegime?.pPositive)}</td><td>{pc(h.baseline.sameMomentum?.pPositive)}</td>
                <td>{h.excessPositive >= 0 ? '+' : ''}{(h.excessPositive * 100).toFixed(1)} pp</td><td>{num(h.pValueVsBaseline, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {result.robustness && (
        <details className="msa-details">
          <summary>{t('analyzer.robustness')} — {t(`analyzer.robust.${result.robustness.verdict}`)}</summary>
          <table className="msa-table">
            <thead><tr><th>×τ</th><th>τ</th><th>{t('analyzer.analogs')} N</th><th>{t('analyzer.biasLabel')}</th><th>N (1h)</th><th>P(&gt;0) 1h</th></tr></thead>
            <tbody>
              {result.robustness.rows.map((r) => (
                <tr key={r.multiplier}><td>{r.multiplier}</td><td>{r.tau.toFixed(2)}</td><td>{r.nAnalogs}</td><td>{t(`analyzer.bias.${r.bias}`)}</td><td>{r.nEff1h}</td><td>{pc(r.pPositive1h)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {result.windows && (
        <details className="msa-details">
          <summary>{t('analyzer.recency')}</summary>
          {result.age && <div className="msa-note">{t('analyzer.ageNote', { recent: result.age.recent, medium: result.age.medium, old: result.age.old })}</div>}
          <table className="msa-table">
            <thead><tr><th>{t('analyzer.window')}</th><th>{t('analyzer.analogs')} N</th><th>{t('analyzer.biasLabel')}</th><th>N (1h)</th><th>P(&gt;0) 1h</th><th>{t('analyzer.baseAll')}</th></tr></thead>
            <tbody>
              {result.windows.map((w) => (
                <tr key={String(w.days)}>
                  <td>{w.days === null ? t('analyzer.windowAll') : t('analyzer.windowDays', { d: w.days })}</td><td>{w.nAnalogs}</td><td>{t(`analyzer.bias.${w.bias}`)}</td>
                  <td>{w.h1?.nEff ?? 0}</td><td>{pc(w.h1?.pPositive.p)}</td><td>{pc(w.h1?.baseline.all.pPositive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {result.groups && (
        <details className="msa-details">
          <summary>{t('analyzer.contrib')}</summary>
          <div className="msa-note">{t('analyzer.contribNote')}</div>
          <table className="msa-table">
            <thead><tr><th>{t('analyzer.group')}</th><th>{t('analyzer.match')}</th><th>{t('analyzer.unusual')}</th></tr></thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.group}><td>{t(`analyzer.groups.${g.group}`)}</td><td className={`msa-match ${g.level}`}>{t(`analyzer.level.${g.level}`)}</td><td>{g.currentZ >= 0 ? '+' : ''}{g.currentZ.toFixed(2)} σ</td></tr>
              ))}
            </tbody>
          </table>
          {result.regime && <div className="msa-note">{t('analyzer.regimeNote', { trend: t(`analyzer.trend.${result.regime.queryTrend}`), n: result.regime.analogsSameTrend, tot: result.nAnalogs })}</div>}
        </details>
      )}

      <details className="msa-details">
        <summary>{t('analyzer.snapshotTitle')}</summary>
        <SnapshotTable snapshot={snapshot} />
      </details>

      {result.components && (
        <details className="msa-details">
          <summary>{t('analyzer.howStrength')}</summary>
          <div className="msa-note">{t('analyzer.strengthFormula')}</div>
          <table className="msa-table">
            <tbody>
              {(Object.entries(result.components) as [string, number][]).map(([k, v]) => (
                <tr key={k}><td>{t(`analyzer.comp.${k}`)}</td><td>{v.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <ValidationBlock validation={validation} storeVersion={result.storeVersion} />

      <details className="msa-details">
        <summary>{t('analyzer.limitsTitle')}</summary>
        <ul className="msa-limits">
          {['l1', 'l2', 'l3', 'l4', 'l5'].map((k) => <li key={k}>{t(`analyzer.limits.${k}`)}</li>)}
        </ul>
      </details>
    </div>
  )
}

function SnapshotTable({ snapshot }: { snapshot: AnalyzerSnapshot }) {
  const { t } = useI18n()
  const d = snapshot.display
  const rows: [string, string][] = [
    [t('analyzer.snap.price'), `${d.price.toLocaleString('en-US')} · mark ${d.markPrice?.toLocaleString('en-US') ?? '—'} · index ${d.indexPrice?.toLocaleString('en-US') ?? '—'}`],
    [t('analyzer.snap.priceChg'), Object.entries(d.priceChangePct).map(([k, v]) => `${k} ${v.toFixed(2)}%`).join(' · ')],
    [t('analyzer.snap.oi'), Object.entries(d.oiChangePct).map(([k, v]) => `${k} ${v.toFixed(2)}%`).join(' · ')],
    [t('analyzer.snap.funding'), `${d.fundingRatePct.toFixed(4)}% · ${t('analyzer.snap.pct')} ${(d.fundingPercentile * 100).toFixed(0)}% · ${d.fundingHistoryPct.map((x) => x.toFixed(4)).join(' → ')}`],
    [t('analyzer.snap.volume'), Object.entries(d.volumeRatio).map(([k, v]) => `${k} ×${v.toFixed(2)}`).join(' · ') + ` · ${t('analyzer.snap.pct')} 1h ${(d.volumePercentile1h * 100).toFixed(0)}%`],
    [t('analyzer.snap.structure'), `24h high ${d.high24h.toLocaleString('en-US')} (${d.distFromHighPct.toFixed(2)}%) · low ${d.low24h.toLocaleString('en-US')} (+${d.distFromLowPct.toFixed(2)}%) · vol 1h ${d.realisedVol1hPct.toFixed(3)}% (×${d.volRatio.toFixed(2)})`],
    [t('analyzer.snap.unavailable'), d.unavailable.join(' · ')],
  ]
  return (
    <table className="msa-table">
      <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
    </table>
  )
}

interface DirBlock { directional: { n: number; accuracy: number | null; ci: [number, number] | null; bestConstantGuess: number; pOneSided: number | null } }

function ValidationBlock({ validation, storeVersion }: { validation: ValidationFile | null; storeVersion: string }) {
  const { t } = useI18n()
  if (!validation) return <div className="msa-note">{t('analyzer.noValidation')}</div>
  const stale = validation.storeVersion !== storeVersion
  const get = (sp: 'train' | 'val' | 'oos', h: string) => (validation.results[sp].horizons[h] as DirBlock | undefined)?.directional
  return (
    <details className="msa-details" open>
      <summary>{t('analyzer.validationTitle')}</summary>
      <div className="msa-note">{t('analyzer.validationNote', { tau: validation.tau0 })}{stale ? ` ⚠ ${t('analyzer.validationStale')}` : ''}</div>
      <table className="msa-table">
        <thead><tr><th>{t('analyzer.split')}</th><th>{t('analyzer.horizon')}</th><th>{t('analyzer.dirCalls')}</th><th>{t('analyzer.accuracy')}</th><th>{t('analyzer.bestConst')}</th><th>p</th></tr></thead>
        <tbody>
          {(['oos', 'val', 'train'] as const).flatMap((sp) =>
            ['30m', '1h', '4h'].map((h) => {
              const d = get(sp, h)
              return (
                <tr key={sp + h} className={sp === 'oos' ? 'msa-oos' : ''}>
                  <td>{t(`analyzer.splitName.${sp}`)}</td><td>{h}</td><td>{d?.n ?? 0}</td>
                  <td>{pc(d?.accuracy)} {d?.ci && <small>[{pc(d.ci[0], 0)}–{pc(d.ci[1], 0)}]</small>}</td><td>{pc(d?.bestConstantGuess)}</td><td>{num(d?.pOneSided, 3)}</td>
                </tr>
              )
            }),
          )}
        </tbody>
      </table>
    </details>
  )
}
