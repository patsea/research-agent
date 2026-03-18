const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = new Database(path.join(__dirname, 'data', 'signals.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY, headline TEXT NOT NULL, company_name TEXT DEFAULT '',
    signal_type TEXT DEFAULT 'other', sector TEXT DEFAULT 'Other', sector_raw TEXT DEFAULT '',
    ai_summary TEXT NOT NULL, signal_date TEXT, source_name TEXT, source_url TEXT DEFAULT '',
    excerpt TEXT DEFAULT '', geography TEXT DEFAULT '', confidence TEXT DEFAULT 'Medium',
    ownership_hint TEXT DEFAULT '',
    method TEXT DEFAULT '', status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now')), run_id TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, method TEXT DEFAULT 'auto',
    last_run TEXT, last_successful_method TEXT DEFAULT '', extraction_prompt TEXT DEFAULT '',
    cadence TEXT DEFAULT 'daily', active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS exclusions (sector TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS dedup_cache (key TEXT PRIMARY KEY, seen_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sector_corrections (
    id TEXT PRIMARY KEY, signal_id TEXT, original_sector TEXT, corrected_sector TEXT,
    headline_excerpt TEXT, source_name TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS run_log (
    id TEXT PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), completed_at TEXT,
    sources_attempted INTEGER DEFAULT 0, sources_succeeded INTEGER DEFAULT 0,
    signals_extracted INTEGER DEFAULT 0, signals_suppressed INTEGER DEFAULT 0,
    signals_written INTEGER DEFAULT 0, errors TEXT DEFAULT ''
  );
`);

const defaultExclusions = ['Gaming','Crypto','Web3','Biotech','Pharma','Hardware','Semiconductor','Defence','Energy','Climate','Real Estate','Food','Retail'];
if (!db.prepare('SELECT COUNT(*) as c FROM exclusions').get().c) {
  const ins = db.prepare('INSERT OR IGNORE INTO exclusions (sector) VALUES (?)');
  defaultExclusions.forEach(s => ins.run(s));
}

const signals = {
  insert(d) {
    const id = uuidv4();
    db.prepare(`INSERT INTO signals (id,headline,company_name,signal_type,sector,sector_raw,ai_summary,signal_date,source_name,source_url,excerpt,geography,confidence,ownership_hint,method,status,run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`)
      .run(id,d.headline,d.company_name||'',d.signal_type||'other',d.sector||'Other',d.sector_raw||'',d.ai_summary,d.signal_date||null,d.source_name||'',d.source_url||'',d.excerpt||'',d.geography||'',d.confidence||'Medium',d.ownership_hint||'',d.method||'',d.run_id||'');
    return id;
  },
  list({status,signal_type,sector,source_name,geography,confidence,limit=200,offset=0}={}) {
    const w=[],p=[];
    if(status){w.push('status=?');p.push(status);}
    if(signal_type){w.push('signal_type=?');p.push(signal_type);}
    if(sector){w.push('sector=?');p.push(sector);}
    if(source_name){w.push('source_name=?');p.push(source_name);}
    if(geography){w.push('geography=?');p.push(geography);}
    if(confidence){w.push('confidence=?');p.push(confidence);}
    return db.prepare(`SELECT * FROM signals ${w.length?'WHERE '+w.join(' AND '):''} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p,limit,offset);
  },
  updateStatus(id,status){db.prepare('UPDATE signals SET status=? WHERE id=?').run(status,id);},
  updateSector(id,sector){
    const s=db.prepare('SELECT sector,headline,source_name FROM signals WHERE id=?').get(id);
    if(!s)return;
    db.prepare('UPDATE signals SET sector=? WHERE id=?').run(sector,id);
    db.prepare('INSERT INTO sector_corrections(id,signal_id,original_sector,corrected_sector,headline_excerpt,source_name) VALUES(?,?,?,?,?,?)').run(uuidv4(),id,s.sector,sector,s.headline.slice(0,80),s.source_name);
  },
  getById(id){return db.prepare('SELECT * FROM signals WHERE id=?').get(id);}
};

const sources = {
  list(){return db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();},
  get(id){return db.prepare('SELECT * FROM sources WHERE id=?').get(id);},
  insert(d){const id=uuidv4();db.prepare('INSERT INTO sources(id,name,url,method,extraction_prompt,cadence) VALUES(?,?,?,?,?,?)').run(id,d.name,d.url,d.method||'auto',d.extraction_prompt||'',d.cadence||'daily');return id;},
  update(id,d){const allowed=['name','url','method','extraction_prompt','cadence','active','last_run','last_successful_method'];const f=Object.keys(d).filter(k=>allowed.includes(k));if(!f.length)return;db.prepare(`UPDATE sources SET ${f.map(k=>k+'=?').join(',')} WHERE id=?`).run(...f.map(k=>d[k]),id);},
  delete(id){db.prepare('DELETE FROM sources WHERE id=?').run(id);}
};

const exclusions = {
  list(){return db.prepare('SELECT sector FROM exclusions ORDER BY sector').all().map(r=>r.sector);},
  add(s){db.prepare('INSERT OR IGNORE INTO exclusions(sector) VALUES(?)').run(s);},
  remove(s){db.prepare('DELETE FROM exclusions WHERE sector=?').run(s);},
  isExcluded(s){return !!db.prepare('SELECT 1 FROM exclusions WHERE sector=? COLLATE NOCASE').get(s);}
};

const dedup = {
  seen(name,type){if(!name)return false;const r=db.prepare('SELECT seen_at FROM dedup_cache WHERE key=?').get(`${name.toLowerCase().trim()}::${type}`);if(!r)return false;return(Date.now()-new Date(r.seen_at).getTime())/(864e5)<30;},
  mark(name,type){if(!name)return;db.prepare("INSERT OR REPLACE INTO dedup_cache(key,seen_at) VALUES(?,datetime('now'))").run(`${name.toLowerCase().trim()}::${type}`);},
  prune(){db.prepare("DELETE FROM dedup_cache WHERE seen_at < datetime('now','-30 days')").run();}
};

const runLog = {
  start(){const id=uuidv4();db.prepare("INSERT INTO run_log(id,started_at) VALUES(?,datetime('now'))").run(id);return id;},
  complete(id,s){db.prepare("UPDATE run_log SET completed_at=datetime('now'),sources_attempted=?,sources_succeeded=?,signals_extracted=?,signals_suppressed=?,signals_written=?,errors=? WHERE id=?").run(s.sources_attempted||0,s.sources_succeeded||0,s.signals_extracted||0,s.signals_suppressed||0,s.signals_written||0,s.errors||'',id);},
  latest(){return db.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT 1').get();},
  list(n=10){return db.prepare('SELECT * FROM run_log ORDER BY started_at DESC LIMIT ?').all(n);}
};

module.exports = {db, signals, sources, exclusions, dedup, runLog};
