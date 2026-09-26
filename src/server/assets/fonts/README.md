# Certificate fonts

`NotoSansDevanagari-Regular.ttf` draws Devanagari recipient names on certificate
PDFs (see `src/server/lib/certificateFonts.ts` and ARCHITECTURE.md).

- Font: Noto Sans Devanagari Regular, version 2.006, © 2022 The Noto Project Authors
  (https://github.com/notofonts/devanagari)
- Source: npm package `@expo-google-fonts/noto-sans-devanagari@0.4.1`
  (`400Regular/NotoSansDevanagari_400Regular.ttf`), a copy of the Google Fonts release
- SHA-256: `084a94d89eb54aafb93a056e15425c34fd859f6342875165d304837b3bcfc2d2`
- License: SIL Open Font License 1.1, in `OFL.txt`

The file is read from disk at runtime and never fetched. If you replace it, re-run
the certificate tests; Devanagari PDFs will change bytes.
