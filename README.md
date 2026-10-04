# Baśnie Karkonoszy

Strona www z panoramą Karkonoszy widzianą z Grodnej (17 miejsc) i czterema krótkimi grami o tym, z czego słynie
dane miejsce. Dla rodzin z dziećmi 8–12 lat, po polsku. Ta sama aplikacja działa jako strona, kiosk w muzeum
(ekran dotykowy) i pojedyncza gra pod kodem QR w terenie. Pixi.js 8 + TypeScript + Vite, dźwięk przez Howler.
Grafikę i dźwięk wygenerowano przez fal.ai, efekty (żar, mgła, światło lampy, pogoda) to shadery GLSL.

| Miejsce | Hash | Gra |
|---|---|---|
| Szklarska Poręba | `#szklarska` | Hutnik z Józefiny: zamówienia klientów, cztery ruchy przy piecu |
| Śnieżka | `#sniezka` | Liczyrzepa i księżniczka Emma: liczenie rzep w pogodzie |
| Kowary | `#kowary` | Sztolnia: lampa, żyły rudy, licznik Geigera |
| Karpacz | `#karpacz` | Laborant: zbieranie ziół, ucieranie, flakon |

Pozostałe 13 miejsc ma w panoramie kartę koncepcji z napisem „Wkrótce”.

## Uruchomienie

```bash
pnpm install && pnpm fonts && pnpm dev   # http://localhost:5173 (--host: widać też w sieci lokalnej)
pnpm test                                # vitest: logika gier, router, Save, I18n, Assets, UI
pnpm build                               # tsc --noEmit + vite build -> dist/
pnpm smoke                               # Playwright (tools/smoke/): hub + przejście Hutnika, zrzuty do docs/screenshots/
```

Fonty są w repo; `pnpm fonts` kopiuje je ponownie z `@fontsource` do `public/fonts/`. Smoke wymaga jednorazowo
`pnpm exec playwright install chromium`. Gotowe `dist/` trzeba serwować przez HTTP (`file://` nie zadziała,
bo aplikacja pobiera manifesty przez `fetch`), np. `pnpm exec vite preview`.

## Routing

Adres czytany jest raz, przy starcie (brak obsługi `hashchange`).

- bez hasha: panorama (hub);
- `#szklarska`, `#sniezka`, `#kowary`, `#karpacz`: od razu odpowiednia gra, bez panoramy. To forma z kodów QR,
  bo niektóre przeglądarki i podglądy obcinają hashe typu `klucz=wartość`;
- `#gra=<id miejsca>` (np. `#gra=kowary`): ta sama gra, zapis historyczny, nadal działa;
- nieznany hash, literówka albo miejsce bez gry (np. `#cieplice`): hub, nigdy pusty ekran;
- gra otwarta z hasha to gra terenowa: wynik zapisuje się z `field: true` (flaga zostaje na stałe). Gra wybrana
  w panoramie nie ustawia flagi;
- `?kiosk=1` włącza tryb kiosku i łączy się z hashem (`/?kiosk=1#kowary`): cele dotykowe co najmniej 96 px (poza
  kioskiem 64 px), po 60 s bez dotyku w grze powrót do panoramy (zapis zostaje, w panoramie licznik nie działa),
  brak linków zewnętrznych. Strona nigdy się nie przewija, także poza kioskiem.

Postęp (najlepsze gwiazdki, data, flaga terenowa) leży w `localStorage` pod `bk.save.v1`, wyciszenie pod
`bk.muted`. Gdy storage jest niedostępny, aplikacja działa dalej z pamięci.

## Struktura

- `src/main.ts`: start (Pixi, fonty, manifesty assetów, router, menedżer scen, licznik bezczynności kiosku)
- `src/core/`: `Scene`/`SceneManager`, `Layout` (przestrzeń 1920×1080, skalowanie „fit”), `Router`, `Save`, `I18n`,
  `Audio` + `moments.ts` (nazwy momentów → klipy), `Assets` (manifest → tekstury, placeholdery), `Kiosk`, `Rng`
- `src/core/fx/`: filtry GLSL: `HeatHazeFilter`, `FogFilter`, `LampLightFilter`, `WeatherFilter`
- `src/ui/`: wspólne elementy: przyciski (`Button`, `HoldButton`), `TopBar`, `SpeechBubble`, `FactCard`, `Stars`,
  `RoundProgress`, `Portrait`, `Loader`, `Theme`
- `src/hub/`: panorama: `PanoramaScene`, `Markers`, `Parallax`, `ConceptCard`
- `src/games/index.ts`: rejestr gier (`glass`→`szklarska`, `turnips`→`sniezka`, `mine`→`kowary`, `herbs`→`karpacz`).
  Każda gra (`glass/`, `turnips/`, `mine/`, `herbs/`) to scena, `rules.ts` (czyste funkcje punktacji, testowane)
  i `pl.json`. Gry importują tylko `core/`, `ui/` i własny katalog
- `src/content/pl.json`: teksty aplikacji i 17 miejsc; teksty gier w `src/games/<gra>/pl.json` (żadnych
  polskich napisów w kodzie)
- `public/assets/gfx`, `public/assets/audio`: wygenerowane WebP i mp3 z `manifest.json`; `public/fonts`: woff2 i licencje
- `tools/assets/`: pipeline assetów (Python); `tools/fonts.sh`; `tools/smoke/`: testy Playwright
- `docs/superpowers/`: spec, plan i przegląd spec kontra kod (`specs/2026-10-04-audit.md`)

## Assety

Obrazy i dźwięki generuje się ręcznie, a wyniki (WebP, mp3, `manifest.json`) commituje. Opis komend, modeli
i decyzji: [`tools/assets/README.md`](tools/assets/README.md) (grafika), [`tools/assets/README-audio.md`](tools/assets/README-audio.md)
(dźwięk).

- Klucz fal.ai: zmienna `FAL_KEY` albo linia `fal: <klucz>` w `~/.api_keys` (`tools/assets/falkey.py`).
  Klucza nie wypisujemy ani nie commitujemy.
- `tools/assets/raw/` (surowe PNG i WAV) jest w `.gitignore` i nigdy nie trafia do repo. Wyjątek: `manifest.lock.json`
  i `audio.lock.json` (model, prompt, seed, URL każdej generacji).
- Budżety: grafika ≤ 40 MB (jest 4,73 MB, 60 plików), dźwięk ≤ 10 MB (jest 5,56 MB, 33 klipy).
  `pack.py --check` i `audio.py --check` działają na czystym klonie, bez `raw/`.

## Build i hosting

`dist/` to statyczne pliki, bez backendu. Wszystkie adresy są względne (`base: './'`, `fetch('assets/…')`,
`fonts/…`), więc build działa z dowolnego podkatalogu, także w podglądzie artefaktów, a routing po hashu nie
wymaga reguł przepisywania na serwerze. `dist/` waży ok. 12 MB. Hosting nie jest jeszcze skonfigurowany.

## Fonty

Fraunces i Nunito z `@fontsource`, na licencji SIL Open Font License 1.1. Pliki `woff2` (podzbiory `latin`
i `latin-ext`, razem pokrywają polskie litery) i pełne teksty licencji (`OFL-Fraunces.txt`, `OFL-Nunito.txt`)
leżą w `public/fonts/`.

## Znane ograniczenia

- Tylko po polsku; teksty są w JSON-ach, więc kolejne języki to osobne słowniki, ale `main.ts` ładuje na razie `pl`.
- Brak PWA i service workera: offline działa tylko tyle, ile utrzyma cache przeglądarki po pierwszym załadowaniu.
- Prawdziwa trasa QR w terenie nie istnieje: jest tylko mechanizm (`#<miejsce>` zapisuje `field: true`).
- Brak WebGL2: komunikat tekstowy po polsku, bez linku do opisu gier.
- Parallax w panoramie reaguje na wskaźnik i dotyk, nie na przechył urządzenia.
- 13 miejsc to same karty koncepcji.

Dokładna lista zgodności ze specyfikacją i luk: [`docs/superpowers/specs/2026-10-04-audit.md`](docs/superpowers/specs/2026-10-04-audit.md).
