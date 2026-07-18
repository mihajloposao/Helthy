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
 * Ključ "fokus-data" — objekat po danima, ključ je datum "YYYY-MM-DD":
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
 *
 * Ključ "fokus-kilaza" — { unosi: { "YYYY-MM-DD": kg }, cilj: number | null,
 *   ciljBaza: number | null }  (ciljBaza = težina u trenutku postavljanja cilja,
 *   da se zna smer: mršavljenje ako je cilj ispod baze, gojenje ako je iznad)
 */

/* ===================== SUPABASE KONFIGURACIJA ===================== */

// URL projekta i PUBLISHABLE (javni) ključ — namenjeni da budu vidljivi u
// browseru. NE koristi secret ključ ovde. Pristup je ograničen RLS pravilom
// na tabelu fokus_store (vidi SQL uz projekat).
var SUPABASE_URL = "https://pvlirqcojbpbvnlsqlmz.supabase.co";
var SUPABASE_KEY = "sb_publishable_4MK0o9GHOkoKbNK7F7223Q_rsdSndSm";
var SUPABASE_TABELA = SUPABASE_URL + "/rest/v1/fokus_store";

/* ===================== MEMORIJSKI KEŠ + SINHRONIZACIJA ===================== */

var KLJUC_PODACI = "fokus-data";
var KLJUC_TAJMER = "fokus-active-timer";
var KLJUC_KILAZA = "fokus-kilaza";

// Keš drži vrednosti kao JSON stringove — tačno kao što je localStorage radio,
// pa se ostatak fajla ponaša identično (parse pri čitanju, stringify pri upisu).
var kes = {};

var prljavi = {};   // key -> "upsert" | "delete" (ima nesnimljenih izmena)
var cekaju = {};    // key -> id setTimeout-a (debounce po ključu)

function supaZaglavlja(dodatna) {
  var z = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
  if (dodatna) {
    for (var k in dodatna) z[k] = dodatna[k];
  }
  return z;
}

// Šalje najnoviju izmenu ključa na server (upsert ili delete). keepalive se
// koristi pri zatvaranju stranice da zahtev preživi.
function posalji(key, keepalive) {
  var tip = prljavi[key];
  if (!tip) return Promise.resolve();

  var url, opcije;
  if (tip === "delete") {
    url = SUPABASE_TABELA + "?key=eq." + encodeURIComponent(key);
    opcije = { method: "DELETE", headers: supaZaglavlja(), keepalive: !!keepalive };
  } else {
    url = SUPABASE_TABELA;
    var value = kes.hasOwnProperty(key) ? JSON.parse(kes[key]) : null;
    opcije = {
      method: "POST",
      headers: supaZaglavlja({ "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" }),
      keepalive: !!keepalive,
      body: JSON.stringify({ key: key, value: value, updated_at: new Date().toISOString() })
    };
  }

  return fetch(url, opcije).then(function (r) {
    if (!r.ok) throw new Error("Supabase " + r.status);
    if (prljavi[key] === tip) delete prljavi[key]; // ako se u međuvremenu nije promenilo
  }).catch(function (e) {
    // Ostavi "prljavi" oznaku da se pokuša ponovo pri sledećem upisu/zatvaranju.
    console.warn("Neuspeo upis na server (" + key + "):", e.message);
  });
}

// Zakazuje slanje sa malim odlaganjem; više brzih izmena istog ključa se stapa.
function zakazi(key, tip) {
  prljavi[key] = tip;
  clearTimeout(cekaju[key]);
  cekaju[key] = setTimeout(function () { posalji(key); }, 600);
}

// Čita string vrednost ključa iz keša (mirror localStorage.getItem).
function getStavka(key) {
  return kes.hasOwnProperty(key) ? kes[key] : null;
}

// Upisuje string vrednost: keš + lokalni backup + zakazan upis na server.
function setStavka(key, str) {
  kes[key] = str;
  try { localStorage.setItem(key, str); } catch (e) {}
  zakazi(key, "upsert");
}

// Briše ključ: keš + lokalni backup + zakazano brisanje na serveru.
function delStavka(key) {
  delete kes[key];
  try { localStorage.removeItem(key); } catch (e) {}
  zakazi(key, "delete");
}

// Učitava sve redove sa servera u keš. Poziva se jednom pri pokretanju.
function ucitajSaServera() {
  return fetch(SUPABASE_TABELA + "?select=key,value", { headers: supaZaglavlja() })
    .then(function (r) {
      if (!r.ok) throw new Error("Supabase " + r.status);
      return r.json();
    })
    .then(function (redovi) {
      kes = {};
      redovi.forEach(function (red) { kes[red.key] = JSON.stringify(red.value); });
    });
}

// Prvi put: ako server nema neki ključ a postoji lokalno (stara localStorage
// verzija), prebaci ga na server da se ništa ne izgubi.
function migracijaIzLokala() {
  var poslovi = [];
  [KLJUC_PODACI, KLJUC_TAJMER, KLJUC_KILAZA].forEach(function (key) {
    if (!kes.hasOwnProperty(key)) {
      var lok = localStorage.getItem(key);
      if (lok !== null) {
        kes[key] = lok;
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
  Object.keys(prljavi).forEach(function (k) { posalji(k, true); });
}
window.addEventListener("pagehide", flushSve);
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") flushSve();
});

/* ===================== DNEVNI PODACI ===================== */

// Učitava ceo objekat sa svim danima. Ako ništa nije sačuvano, vraća prazan objekat.
function ucitajSvePodatke() {
  var sirovo = getStavka(KLJUC_PODACI);
  if (sirovo === null) {
    return {};
  }
  return JSON.parse(sirovo);
}

// Snima ceo objekat sa svim danima.
function sacuvajSvePodatke(podaci) {
  setStavka(KLJUC_PODACI, JSON.stringify(podaci));
}

// Vraća podatke za jedan dan. Ako dan ne postoji, vraća prazan dan
// (ne upisuje ga — upis se dešava tek kad se nešto stvarno doda).
function ucitajDan(datum) {
  var podaci = ucitajSvePodatke();
  if (podaci[datum]) {
    return podaci[datum];
  }
  return { fixedEvents: [], items: [], sessions: [], obaveze: [] };
}

// Snima podatke za jedan dan.
function sacuvajDan(datum, dan) {
  var podaci = ucitajSvePodatke();
  podaci[datum] = dan;
  sacuvajSvePodatke(podaci);
}

// Da li za dati datum postoji sačuvan plan (bar jedna stavka ili obaveza)?
function danImaPlan(datum) {
  var podaci = ucitajSvePodatke();
  var dan = podaci[datum];
  if (!dan) return false;
  return dan.items.length > 0 || (dan.obaveze && dan.obaveze.length > 0);
}

/* ===================== OBROCI ===================== */

// Obroci upisani za dati dan (prazan niz ako ih nema).
function ucitajObroke(datum) {
  var dan = ucitajDan(datum);
  return dan.obroci || [];
}

// Da li dan ima bar jedan upisan obrok? Namerno odvojeno od danImaPlan —
// obroci ne treba da utiču na streak/ocenu ispunjenja plana.
function danImaObroke(datum) {
  return ucitajObroke(datum).length > 0;
}

// Dodaje obrok u dati dan.
function dodajObrok(datum, obrok) {
  var dan = ucitajDan(datum);
  if (!dan.obroci) dan.obroci = [];
  dan.obroci.push(obrok);
  sacuvajDan(datum, dan);
}

// Briše obrok iz datog dana po id-u.
function obrisiObrok(datum, id) {
  var dan = ucitajDan(datum);
  if (!dan.obroci) return;
  dan.obroci = dan.obroci.filter(function (o) { return o.id !== id; });
  sacuvajDan(datum, dan);
}

/* ===================== AKTIVNI TAJMER ===================== */

// Vraća aktivni tajmer ili null ako nijedan tajmer ne radi.
function ucitajAktivniTajmer() {
  var sirovo = getStavka(KLJUC_TAJMER);
  if (sirovo === null) {
    return null;
  }
  return JSON.parse(sirovo);
}

// Snima aktivni tajmer.
function sacuvajAktivniTajmer(tajmer) {
  setStavka(KLJUC_TAJMER, JSON.stringify(tajmer));
}

// Briše aktivni tajmer (poziva se kad se tajmer zaustavi).
function obrisiAktivniTajmer() {
  delStavka(KLJUC_TAJMER);
}

/* ===================== KILAŽA ===================== */

// Učitava ceo objekat kilaže; ako ništa nije sačuvano, vraća prazan.
function ucitajKilazu() {
  var sirovo = getStavka(KLJUC_KILAZA);
  if (sirovo === null) {
    return { unosi: {}, cilj: null };
  }
  var o = JSON.parse(sirovo);
  if (!o.unosi) o.unosi = {};
  if (o.cilj === undefined) o.cilj = null;
  if (o.ciljBaza === undefined) o.ciljBaza = null; // težina kad je cilj postavljen (za smer)
  return o;
}

// Snima ceo objekat kilaže.
function sacuvajKilazu(kilaza) {
  setStavka(KLJUC_KILAZA, JSON.stringify(kilaza));
}
