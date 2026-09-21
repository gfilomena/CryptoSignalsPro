// Counts invalidation pushes whose streak never notified the user, per confirmation setting (decision range).
import { loadDataset, DATA_START, VAL_END } from './lib'
import { buildSnapshotSeries, runSmartAlert } from './smartReplay'
const s = buildSnapshotSeries(loadDataset())
for (const id of ['reversal_watch', 'strong_momentum', 'overheated_market'] as const) for (const c of [1, 2, 3]) {
  const ev = runSmartAlert(s, { presetId: id, confirmationCycles: c, toT: VAL_END })
  const f = ev.filter((e) => e.kind === 'fired').length, inv = ev.filter((e) => e.kind === 'invalidated'), orph = inv.filter((e) => !e.streakHadFired).length
  console.log(id, 'confirmSteps', c, 'fired', f, 'invalidations', inv.length, 'orphan(no notification for this streak)', orph)
}
