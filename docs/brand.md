# Eithr brand basics

## Name

- **Eithr**: capital E in sentences, lowercase in the logo (**eithr?**).
- Said **"ee-ther"**, like "either". In videos and voice-overs always "ee-ther" (the video kit
  respells it "Eether" for the voice; see `scripts/video-kit/README.md`).
- "an Eithr account" (it starts with a vowel sound).
- Web: **eithr.app** (main), eithr.in (forwards to it). The system account is **@eithr**.
- Formerly Docchi. Internal names in the code and database (storage keys, error codes) still say
  "docchi"; users never see them.

## Logo

- The mascot: a yellow speech bubble whose eyes are the two sides, **coral** (left) and **sky**
  (right), glancing between answers. `src/components/Logo.tsx`, `public/icon.svg`.
- Wordmark: **eithr** + a coral **?**. Bricolage Grotesque ExtraBold, tight letter spacing.
- App icon: the mascot on coral. Regenerate the PNGs (`public/icons/`, `src/app/apple-icon.png`)
  from `public/icon.svg` if it changes.

## Taglines

Rotate on the share card (one per poll, so the image and its preview match) and the install
screen (random each time). `src/lib/brand.ts`:

- Pick a side.
- Settle it.
- This or that?
- No fence-sitting.
- Your take counts.
- Pick one. See everyone.

## Colours and type

| Token | Hex | Use |
|---|---|---|
| ink | `#1B1530` | text, outlines, shadows |
| cream | `#FFF7EC` | page background |
| sun | `#FFD23F` | mascot, highlights |
| coral | `#FF7A59` | left eye, "?", main buttons |
| sky | `#6CB4FF` | right eye, second answer |
| mint | `#52D6A8` | success, friends |
| lilac | `#C4A8FF` | Props, playful panels |

Type: Bricolage Grotesque (display) and DM Sans (body), both in `assets/fonts/`. The look is a
"pop poster": thick ink outlines, hard offset shadows, rounded shapes.
