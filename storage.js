/*
 * storage.js — perzistencija podataka.
 *
 * Podaci žive u Supabase-u (Postgres u oblaku), pa su trajni i dostupni sa
 * više uređaja. Da ostatak aplikacije ne bi morao da čeka mrežu, ovde se drži
 * MEMORIJSKI KEŠ: pri pokretanju se svi podaci jednom učitaju sa servera
 * (ucitajSveIzBaze), pa sva dalja čitanja ostaju trenutna kao pre. Svaki upis
 * odmah menja keš (i lokalni backup u localStorage), a na server se šalje u
 * pozadini sa malim odlaganjem (debounce), i "flush"-uje pri zatvaranju.
 *
 * Ovaj fajl NE zna ništa o UI-ju.
 *
 * Struktura podataka (isti oblici kao ranije, sad kao redovi u tabeli
 * fokus_store: key = ime ključa, value = JSON):
 *
 * Ključ "fokus-planovi" — objekat po danima, ključ je datum "YYYY-MM-DD":
 *   {
 *     "2026-07-04": {
 *       fixedEvents: [ { naziv, od: "09:00", do: "10:30" } ],
 *       items:       [ { id, naziv, boja, ciljMinuta } ],
 *       sessions:    [ { itemId, start: timestamp_ms, end: timestamp_ms } ],
 *       obaveze:     [ { id, naziv, checkedAt: timestamp_ms | null } ],
 *       treninzi:    [ { id, naziv, od: "17:30", do: "18:40",
 *                        linije: "slobodan tekst\npo redu", tezina: 1-5, beleska } ],
 *       obroci:      [ { id, opis, kcal, protein, ugljeni, masti,
 *                        upisan: timestamp_ms } ],   // masti: stariji unosi ih nemaju
 *       ocena:       0,     // ocena dana 0–5 (opciono; 0 = neocenjeno)
 *       beleska:     ""     // beleška o danu (opciono)
 *     }
 *   }
 *
 * Ključ "fokus-active-timer" — trenutno aktivan tajmer ili null:
 *   { itemId, datum, start: timestamp_ms | null, pausedElapsed: ms }
 *   (ova aplikacija ga ne koristi, ali ga Fokus koristi — zato se ključ i dalje
 *    migrira i ne dira)
 *
 * Ključ "kilaza-trening" — { unosi: { "YYYY-MM-DD": kg }, cilj: number | null,
 *   ciljBaza: number | null }  (ciljBaza = težina u trenutku postavljanja cilja,
 *   da se zna smer: mršavljenje ako je cilj ispod baze, gojenje ako je iznad)
 */

/* ===================== SUPABASE KONFIGURACIJA ===================== */

// URL projekta i PUBLISHABLE (javni) ključ — namenjeni da budu vidljivi u
// browseru. NE koristi secret ključ ovde. Pristup je ograničen RLS pravilom
// na tabelu fokus_store (vidi SQL uz projekat).
const SUPABASE_URL = "https://pvlirqcojbpbvnlsqlmz.supabase.co";
const SUPABASE_KEY = "sb_publishable_4MK0o9GHOkoKbNK7F7223Q_rsdSndSm";
const SUPABASE_TABELA = SUPABASE_URL + "/rest/v1/fokus_store";

/* ===================== MEMORIJSKI KEŠ + SINHRONIZACIJA ===================== */

const KLJUC_PODACI = "fokus-planovi";
const KLJUC_TAJMER = "fokus-active-timer";
const KLJUC_KILAZA = "kilaza-trening";

// Keš drži vrednosti kao JSON stringove — tačno kao što je localStorage radio,
// pa se ostatak fajla ponaša identično (parse pri čitanju, stringify pri upisu).
let kes = {};

// Drugi nivo keša: već isparsirani objekti po ključu. JSON.parse celog store-a
// je skup, a renderi (Istorija, poslednji dani) čitaju podatke stotinama puta
// po prolazu. Upis kroz setStavka/delStavka poništava ovaj keš za taj ključ.
let parsirano = {};

const prljavi = {};   // key -> "upsert" | "delete" (ima nesnimljenih izmena)
const cekaju = {};    // key -> id setTimeout-a (debounce po ključu)

function supaZaglavlja(dodatna) {
  return Object.assign(
    { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY },
    dodatna
  );
}

// Šalje najnoviju izmenu ključa na server (upsert ili delete). keepalive se
// koristi pri zatvaranju stranice da zahtev preživi.
function posalji(key, keepalive) {
  const tip = prljavi[key];
  if (!tip) return Promise.resolve();

  let url, opcije;
  if (tip === "delete") {
    url = `${SUPABASE_TABELA}?key=eq.${encodeURIComponent(key)}`;
    opcije = { method: "DELETE", headers: supaZaglavlja(), keepalive: !!keepalive };
  } else {
    url = SUPABASE_TABELA;
    const value = Object.prototype.hasOwnProperty.call(kes, key) ? JSON.parse(kes[key]) : null;
    opcije = {
      method: "POST",
      headers: supaZaglavlja({ "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" }),
      keepalive: !!keepalive,
      body: JSON.stringify({ key: key, value: value, updated_at: new Date().toISOString() })
    };
  }

  return fetch(url, opcije).then((r) => {
    if (!r.ok) throw new Error("Supabase " + r.status);
    if (prljavi[key] === tip) delete prljavi[key]; // ako se u međuvremenu nije promenilo
  }).catch((e) => {
    // Ostavi "prljavi" oznaku da se pokuša ponovo pri sledećem upisu/zatvaranju.
    console.warn(`Neuspeo upis na server (${key}):`, e.message);
  });
}

// Zakazuje slanje sa malim odlaganjem; više brzih izmena istog ključa se stapa.
function zakazi(key, tip) {
  prljavi[key] = tip;
  clearTimeout(cekaju[key]);
  cekaju[key] = setTimeout(() => posalji(key), 600);
}

// Čita string vrednost ključa iz keša (mirror localStorage.getItem).
function getStavka(key) {
  return Object.prototype.hasOwnProperty.call(kes, key) ? kes[key] : null;
}

// Upisuje string vrednost: keš + lokalni backup + zakazan upis na server.
function setStavka(key, str) {
  kes[key] = str;
  delete parsirano[key];   // isparsirana kopija više nije verodostojna
  try { localStorage.setItem(key, str); } catch (e) {}
  zakazi(key, "upsert");
}

// Briše ključ: keš + lokalni backup + zakazano brisanje na serveru. Ova
// aplikacija trenutno ne briše nijedan ključ (parnjak setStavka za "delete"
// granu sinhronizacije).
function delStavka(key) {
  delete kes[key];
  delete parsirano[key];
  try { localStorage.removeItem(key); } catch (e) {}
  zakazi(key, "delete");
}

// Učitava sve redove sa servera u keš. Poziva se jednom pri pokretanju.
function ucitajSaServera() {
  return fetch(SUPABASE_TABELA + "?select=key,value", { headers: supaZaglavlja() })
    .then((r) => {
      if (!r.ok) throw new Error("Supabase " + r.status);
      return r.json();
    })
    .then((redovi) => {
      kes = {};
      parsirano = {};
      redovi.forEach((red) => { kes[red.key] = JSON.stringify(red.value); });
    });
}

// Prvi put: ako server nema neki ključ a postoji lokalno (stara localStorage
// verzija), prebaci ga na server da se ništa ne izgubi.
function migracijaIzLokala() {
  const poslovi = [];
  [KLJUC_PODACI, KLJUC_TAJMER, KLJUC_KILAZA].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(kes, key)) {
      const lok = localStorage.getItem(key);
      if (lok !== null) {
        kes[key] = lok;
        delete parsirano[key];
        prljavi[key] = "upsert";
        poslovi.push(posalji(key));
      }
    }
  });
  return Promise.all(poslovi);
}

// Bootstrap koji app.js zove pre prvog rendera.
function ucitajSveIzBaze() {
  return ucitajSaServera().then(migracijaIzLokala);
}

// Pri zatvaranju/skrivanju stranice pošalji sve nesnimljene izmene odmah.
function flushSve() {
  Object.keys(prljavi).forEach((k) => posalji(k, true));
}
window.addEventListener("pagehide", flushSve);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSve();
});

/* ===================== DNEVNI PODACI ===================== */

// Učitava ceo objekat sa svim danima. Ako ništa nije sačuvano, vraća prazan
// objekat. Parsira se najviše jednom po izmeni — dalja čitanja vraćaju isti
// objekat iz keša.
function ucitajSvePodatke() {
  let podaci = parsirano[KLJUC_PODACI];
  if (podaci === undefined) {
    const sirovo = getStavka(KLJUC_PODACI);
    podaci = sirovo === null ? {} : JSON.parse(sirovo);
    parsirano[KLJUC_PODACI] = podaci;
  }
  return podaci;
}

// Snima ceo objekat sa svim danima.
function sacuvajSvePodatke(podaci) {
  setStavka(KLJUC_PODACI, JSON.stringify(podaci));
  parsirano[KLJUC_PODACI] = podaci;  // upravo snimljen objekat je i dalje tačan
}

// Vraća podatke za jedan dan. Ako dan ne postoji, vraća prazan dan
// (ne upisuje ga — upis se dešava tek kad se nešto stvarno doda).
function ucitajDan(datum) {
  return ucitajSvePodatke()[datum] || { fixedEvents: [], items: [], sessions: [], obaveze: [] };
}

// Snima podatke za jedan dan.
function sacuvajDan(datum, dan) {
  const podaci = ucitajSvePodatke();
  podaci[datum] = dan;
  sacuvajSvePodatke(podaci);
}

/* ===================== OBROCI ===================== */

// Obroci upisani za dati dan (prazan niz ako ih nema).
function ucitajObroke(datum) {
  return ucitajDan(datum).obroci || [];
}

// Da li dan ima bar jedan upisan obrok?
function danImaObroke(datum) {
  return ucitajObroke(datum).length > 0;
}

// Dodaje obrok u dati dan.
function dodajObrok(datum, obrok) {
  const dan = ucitajDan(datum);
  if (!dan.obroci) dan.obroci = [];
  dan.obroci.push(obrok);
  sacuvajDan(datum, dan);
}

// Briše obrok iz datog dana po id-u.
function obrisiObrok(datum, id) {
  const dan = ucitajDan(datum);
  if (!dan.obroci) return;
  dan.obroci = dan.obroci.filter((o) => o.id !== id);
  sacuvajDan(datum, dan);
}

/* ===================== KILAŽA ===================== */

// Učitava ceo objekat kilaže; ako ništa nije sačuvano, vraća prazan.
// Kao i dnevni podaci, parsira se jednom pa se drži u kešu.
function ucitajKilazu() {
  let k = parsirano[KLJUC_KILAZA];
  if (k === undefined) {
    const sirovo = getStavka(KLJUC_KILAZA);
    if (sirovo === null) {
      k = { unosi: {}, cilj: null };
    } else {
      k = JSON.parse(sirovo);
      if (!k.unosi) k.unosi = {};
      if (k.cilj === undefined) k.cilj = null;
      if (k.ciljBaza === undefined) k.ciljBaza = null; // težina kad je cilj postavljen (za smer)
    }
    parsirano[KLJUC_KILAZA] = k;
  }
  return k;
}

// Snima ceo objekat kilaže.
function sacuvajKilazu(kilaza) {
  setStavka(KLJUC_KILAZA, JSON.stringify(kilaza));
  parsirano[KLJUC_KILAZA] = kilaza;
}
