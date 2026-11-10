// Immutable once released. Runtime verifies this exact SQL against its ledger.
export const initialSchema = `
CREATE TABLE schema_migrations (
  id INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;
CREATE TABLE app_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  dataset_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  initialized_at INTEGER NOT NULL
) STRICT;
CREATE TABLE pharmacies (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL UNIQUE DEFAULT 1 CHECK(singleton=1),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  contact TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata' CHECK(timezone='Asia/Kolkata'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL UNIQUE REFERENCES pharmacies(id),
  identifier TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL CHECK(json_valid(password_hash)),
  recovery_hash TEXT NOT NULL CHECK(json_valid(recovery_hash)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version>0),
  UNIQUE(pharmacy_id,id)
) STRICT;
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY CHECK(id=1),
  attempts INTEGER NOT NULL CHECK(attempts>=0),
  blocked_until INTEGER NOT NULL,
  last_at INTEGER NOT NULL
) STRICT;
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL CHECK(length(phone_key)>0),
  age INTEGER CHECK(age BETWEEN 0 AND 130),
  notes TEXT NOT NULL DEFAULT '',
  archived_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pharmacy_id,id)
) STRICT;
CREATE INDEX customer_name ON customers(pharmacy_id,name_key,id);
CREATE INDEX customer_phone ON customers(pharmacy_id,phone_key,id);
CREATE TABLE medicines (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  name TEXT NOT NULL CHECK(length(name)>0),
  strength TEXT NOT NULL,
  form TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  archived_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pharmacy_id,id),
  UNIQUE(pharmacy_id,identity_key)
) STRICT;
CREATE TABLE number_counters (
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),
  kind TEXT NOT NULL CHECK(kind='purchase'),
  next_number INTEGER NOT NULL CHECK(next_number>0),
  PRIMARY KEY(pharmacy_id,kind)
) STRICT;
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  purchase_date TEXT NOT NULL CHECK(purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('active','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pharmacy_id,id),
  UNIQUE(pharmacy_id,sequence),
  FOREIGN KEY(pharmacy_id,customer_id) REFERENCES customers(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,created_by) REFERENCES users(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,updated_by) REFERENCES users(pharmacy_id,id)
) STRICT;
CREATE TRIGGER purchase_sequence_immutable BEFORE UPDATE OF sequence ON purchases WHEN NEW.sequence<>OLD.sequence BEGIN SELECT RAISE(ABORT,'Purchase sequence is immutable'); END;
CREATE INDEX purchase_customer_date ON purchases(pharmacy_id,customer_id,purchase_date,sequence);
CREATE INDEX purchase_date ON purchases(pharmacy_id,purchase_date,sequence);
CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  medicine_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  strength_snapshot TEXT NOT NULL,
  form_snapshot TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli BETWEEN 1 AND 999999000),
  unit TEXT NOT NULL CHECK(unit IN ('tablets','strips','capsules','bottles','packs','tubes','sachets','other')),
  position INTEGER NOT NULL CHECK(position>=0),
  UNIQUE(pharmacy_id,purchase_id,medicine_id,unit),
  UNIQUE(pharmacy_id,purchase_id,position),
  FOREIGN KEY(pharmacy_id,purchase_id) REFERENCES purchases(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,medicine_id) REFERENCES medicines(pharmacy_id,id)
) STRICT;
CREATE INDEX item_medicine ON purchase_items(pharmacy_id,medicine_id,purchase_id);
CREATE TABLE medicine_supplies (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  medicine_id TEXT NOT NULL,
  included INTEGER NOT NULL CHECK(included IN (0,1)),
  start_date TEXT NOT NULL,
  new_days INTEGER NOT NULL CHECK(new_days BETWEEN 1 AND 365),
  mode TEXT NOT NULL CHECK(mode IN ('extend','replace')),
  remaining_override INTEGER CHECK(remaining_override BETWEEN 0 AND 365),
  remaining_used INTEGER NOT NULL CHECK(remaining_used>=0),
  run_out_date TEXT NOT NULL,
  reminder_enabled INTEGER NOT NULL CHECK(reminder_enabled IN (0,1)),
  manual_reminder_date TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(pharmacy_id,id),
  UNIQUE(pharmacy_id,purchase_id,medicine_id),
  FOREIGN KEY(pharmacy_id,customer_id) REFERENCES customers(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,purchase_id) REFERENCES purchases(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,medicine_id) REFERENCES medicines(pharmacy_id,id)
) STRICT;
CREATE INDEX supply_chain ON medicine_supplies(pharmacy_id,customer_id,medicine_id,purchase_id);
CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  medicine_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  supply_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','closed','superseded')),
  calculated_date TEXT NOT NULL,
  manual_date TEXT,
  next_date TEXT NOT NULL,
  last_contact_at INTEGER,
  closed_at INTEGER,
  closure_reason TEXT,
  resolving_purchase_id TEXT,
  paused_state TEXT CHECK(paused_state IS NULL OR json_valid(paused_state)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK((status='open' AND closed_at IS NULL AND closure_reason IS NULL AND resolving_purchase_id IS NULL) OR (status<>'open' AND closed_at IS NOT NULL AND closure_reason IS NOT NULL)),
  UNIQUE(pharmacy_id,id),
  UNIQUE(pharmacy_id,supply_id),
  FOREIGN KEY(pharmacy_id,customer_id) REFERENCES customers(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,medicine_id) REFERENCES medicines(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,purchase_id) REFERENCES purchases(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,supply_id) REFERENCES medicine_supplies(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,resolving_purchase_id) REFERENCES purchases(pharmacy_id,id)
) STRICT;
CREATE UNIQUE INDEX one_open_follow_up ON follow_ups(pharmacy_id,customer_id,medicine_id) WHERE status='open';
CREATE INDEX follow_up_due ON follow_ups(pharmacy_id,status,next_date,id);
CREATE INDEX follow_up_customer ON follow_ups(pharmacy_id,customer_id,id);
CREATE TABLE follow_up_events (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  follow_up_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(pharmacy_id,follow_up_id) REFERENCES follow_ups(pharmacy_id,id),
  FOREIGN KEY(pharmacy_id,actor_id) REFERENCES users(pharmacy_id,id)
) STRICT;
CREATE INDEX follow_up_history ON follow_up_events(pharmacy_id,follow_up_id,created_at,id);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(pharmacy_id,actor_id) REFERENCES users(pharmacy_id,id)
) STRICT;
CREATE INDEX audit_history ON audit_events(pharmacy_id,entity_type,entity_id,created_at,id);
CREATE TABLE mutation_receipts (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  command TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(pharmacy_id,actor_id,request_id),
  FOREIGN KEY(pharmacy_id,actor_id) REFERENCES users(pharmacy_id,id)
) STRICT;
`;
