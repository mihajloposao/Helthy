/*
 * service-worker.js — minimalni keš da aplikacija radi offline.
 *
 * Strategija "cache-first": pri instalaciji se svi fajlovi aplikacije snime
 * u keš, a svaki zahtev se prvo služi iz keša (pa tek onda sa mreže).
 * Podaci korisnika NISU ovde — oni žive u Supabase-u / localStorage-u.
 *
 * VAŽNO: kad izmeniš bilo koji fajl aplikacije, povećaj broj verzije u
 * KES_NAZIV (npr. "kilaza-trening-v2") da bi korisnici dobili novu verziju.
 */

var KES_NAZIV = "kilaza-trening-v5";

var FAJLOVI = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png"
];

// Pri instalaciji: snimi sve fajlove aplikacije u keš.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(KES_NAZIV).then(function (kes) {
      return kes.addAll(FAJLOVI);
    })
  );
  self.skipWaiting();
});

// Pri aktivaciji: obriši keševe starih verzija.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (nazivi) {
      return Promise.all(
        nazivi
          .filter(function (naziv) { return naziv !== KES_NAZIV; })
          .map(function (naziv) { return caches.delete(naziv); })
      );
    })
  );
  self.clients.claim();
});

// Keširamo samo app shell (isti origin, GET zahtevi). Pozivi ka Supabase-u
// (drugi origin, POST/DELETE) idu direktno na mrežu, bez mešanja SW-a.
self.addEventListener("fetch", function (event) {
  var zahtev = event.request;
  if (zahtev.method !== "GET" || new URL(zahtev.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(zahtev).then(function (odgovor) {
      return odgovor || fetch(zahtev);
    })
  );
});
