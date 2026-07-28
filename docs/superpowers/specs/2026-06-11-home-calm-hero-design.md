# Home Calm Hero Redesign

## Goal

Redesign the authenticated home screen so it feels visually polished without becoming an information-heavy dashboard. The home screen should help a learner decide what to do next in a few seconds.

## UX Direction

- Make the first viewport a calm learning start point, not a dense dashboard.
- Put one primary action first: continue learning from the latest video.
- Use the latest video thumbnail as the main visual asset.
- Keep secondary actions visible but quiet: browse courses, inspect the next queue, and glance at stats.
- Move counts and lists below the hero so they support the decision instead of competing with it.

## Screen Structure

1. Personalized hero copy with a small status chip and two actions.
2. Large latest-video card with thumbnail, title, summary, and direct play action.
3. Lower section with a small next-learning queue and compact learning stats.
4. Empty states that point to the next useful action instead of showing dead cards.

## Implementation Scope

- Update only `HomePage` markup in `web/src/App.tsx`.
- Replace the home-specific CSS rules in `web/src/App.css`.
- Reuse existing data already loaded by the home screen: posts, playlists, latest post, latest playlist, and playlist posts.
- Do not add new API calls or dependencies.

## Verification

- Run the web build.
- Confirm no fixed pixel `font-size` declarations return in `web/src`.
