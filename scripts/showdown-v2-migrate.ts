// Season 2 migration, dry run by default. Reads a COPY of the database, shows what migrateV2 would change, and only
// writes when --write is given (to --out, or back to the input after saving a .bak next to it). It never talks to a
// chain and never sends anything. The server runs the same migration once at boot, so this is for checking first.
//
//   npx tsx scripts/showdown-v2-migrate.ts path/to/db-copy.json            # report only
//   npx tsx scripts/showdown-v2-migrate.ts path/to/db-copy.json --write --out migrated.json
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { migrateV2, type CampaignState } from '../server/campaign'
import { POOL_IDS, POOL_LABEL, type PoolId } from '../shared/campaign'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) { console.error('Usage: showdown-v2-migrate.ts <db.json copy> [--write] [--out file]'); process.exit(1) }
const write = args.includes('--write')
const outIdx = args.indexOf('--out')
const out = outIdx >= 0 ? args[outIdx + 1] : file
if (/^\/data\//.test(out) && !args.includes('--live-path-ok')) { console.error('Refusing to write under /data. Work on a copy.'); process.exit(1) }

const db = JSON.parse(readFileSync(file, 'utf8'))
const st = db.campaign as CampaignState | undefined
if (!st) { console.log('No Showdown state in this database. Nothing to migrate.'); process.exit(0) }
if (st.v2) { console.log(`Already migrated at ${new Date(st.v2.at).toISOString()}. Nothing to do.`); process.exit(0) }
const allocated = (p: PoolId) => Object.values(st.rewards ?? {}).filter((r) => r.pool === p && r.status !== 'cancelled').reduce((s, r) => s + r.luna, 0)
const rep = migrateV2(st, allocated)!
const nim = (l: number) => (l / 1e5).toFixed(2).padStart(10)
console.log('Pool'.padEnd(34), 'before'.padStart(10), 'after'.padStart(10))
for (const p of POOL_IDS) console.log(POOL_LABEL[p].padEnd(34), nim(rep.before[p] ?? 0), nim(rep.after[p] ?? 0))
const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0)
console.log('Total'.padEnd(34), nim(total(rep.before)), nim(total(rep.after)))
console.log(`Season 1 paid or committed: ${nim(rep.legacyAllocated).trim()} NIM`)
console.log(`Unsent season 1 rewards moved to review: ${rep.heldLegacy}`)
let jars = 0
for (const p of Object.values<any>(db.profiles ?? {})) jars += p.cjar?.luna ?? 0
console.log(`Owed to Showdown jars (ring-fenced, not in any pool): ${nim(jars).trim()} NIM`)
console.log('Payouts after migration: PAUSED')
if (!write) { console.log('\nDry run. Nothing written. Add --write to save.'); process.exit(0) }
if (out === file) copyFileSync(file, file + '.bak')
writeFileSync(out, JSON.stringify(db))
console.log(`Written to ${out}${out === file ? ` (backup at ${file}.bak)` : ''}`)
