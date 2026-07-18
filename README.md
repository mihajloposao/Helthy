# Kilaža & Trening

Lična aplikacija za praćenje **kilaže**, **treninga** i **obroka**. Izdvojena je
iz [Fokus](https://github.com/mihajloposao/fokus) aplikacije u zaseban projekat —
Fokus je ostao samo za planiranje dana, a sve vezano za kilažu/trening/obroke
živi ovde.

Jednokorisnička PWA. Plain HTML + CSS + vanilla JavaScript, bez frameworka i
build alata.

## Šta radi

- **Kilaža** — dnevni unos težine (stepper), grafik trenda sa 7-dnevnim prosekom,
  ciljna kilaža sa trakom napretka, i statistika (trenutna / prosek / najniža).
- **Obroci** — unos kalorija i makroa (proteini / ugljeni hidrati / masti) po
  obroku, sa dnevnim zbirom. Nalaze se na Kilaža ekranu.
- **Treninzi** — dnevnik treninga: naziv, termin, težina sesije (1–5 tegova),
  spisak vežbi i beleška. Lista poslednjih treninga sa detaljnim prikazom.

## Struktura fajlova

| Fajl                | Šta radi |
|---------------------|----------|
| `index.html`        | Markup: 3 ekrana (Kilaža, Treninzi, Detalj treninga) + donja navigacija |
| `style.css`         | Svi stilovi, "Ink + Paper" vizuelni identitet (deljeni sa Fokusom) |
| `app.js`            | Stanje, render funkcije i logika za kilažu, obroke i treninge |
| `storage.js`        | Čitanje/pisanje podataka (Supabase keš) — deljeno sa Fokusom |
| `manifest.json`     | PWA manifest — "Dodaj na početni ekran" |
| `service-worker.js` | Minimalni keš za offline rad |
| `icon-*.png`        | Ikonice aplikacije |

## Podaci (deljeni backend sa Fokusom)

`storage.js` je isti kao u Fokusu i koristi **isti Supabase projekat i iste
ključeve**:

- `kilaza-trening` — kilaža (unosi + cilj). Samo ova aplikacija je diraju.
- `fokus-planovi` — dnevni objekti; treninzi i obroci žive unutar dana
  (`dan.treninzi`, `dan.obroci`), pored planova koje piše Fokus.

Zato se svi tvoji **postojeći** treninzi/obroci/kilaža automatski vide ovde,
bez migracije.

> **Napomena o istovremenom radu:** i Fokus i ova aplikacija pišu ključ
> `fokus-planovi` (svaka svoj deo dana). Svaka aplikacija čita ceo dan, menja svoj
> deo i upisuje ceo dan nazad, pa čuva tuđe podatke. Pošto je sinhronizacija
> "poslednji upis pobeđuje", teoretski je moguć konflikt samo ako istovremeno
> menjaš isti dan u obe aplikacije pre nego što se prva sinhronizuje. Za
> jednog korisnika koji koristi jednu po jednu aplikaciju — nije problem.

## Pokretanje lokalno

```
python -m http.server 8000
```

pa otvori `http://localhost:8000`.

## Objavljivanje

Isti postupak kao za Fokus: povuci repo na Netlify ili Vercel (bez build
komande, publish directory je koren), pa otvori dobijeni URL na telefonu i
izaberi "Dodaj na početni ekran".

Za svaku izmenu povećaj verziju keša u `service-worker.js`
(`kilaza-trening-v1` → `-v2`) da instalirane kopije povuku novu verziju.
